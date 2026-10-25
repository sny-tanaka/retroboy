// 通信ケーブルの 2 台の進みを合わせる（docs/link-cable-design.md 3 章）。
//
// 規則は 2 つ:
//   1. 相手から最後に聞いた時刻 ＋ WINDOW より先へは進まない（着いたら止まって、相手のメッセージを待つ）
//   2. 親機は返事が来るまで、転送が終わる時刻の先へ進まない（コアの linkStep が「返事待ち」で止まる）
// 止まる直前には必ず自分の時刻（time）を送るので、両方が同時に止まったままになることはない。
//
// 時刻をそろえる: 自分のコアを通信につなぐ（ゲームを始める・道がつながる）たびに、コアの時刻を 0 にして
// start を送る。受けた側もコアの時刻を 0 にする。epoch で、そろえる前のメッセージを見分けて捨てる。
//
// 音で進む作り（useAudioSync.ts）からは、つないでいる間だけ step() を回してもらう。止まったら setTimeout を
// 予約せずに抜け、相手のメッセージが届いたら onWake で呼び直してもらう。
import {
    linkClock,
    linkDeliverReply,
    linkDeliverTransfer,
    linkSetConnected,
    linkStep,
    linkTakeEvent,
} from "../core/retroboyCore";
import {
    decodeMessage,
    encodeMessage,
    type LinkMessage,
    PROTOCOL_VERSION,
} from "./protocol";
import type { LinkTransport, TransportState } from "./transport";

const T_CYCLES_PER_MS = 4194.304;

// 相手より先に進んでよい時間（ゲーム内）。往復の時間の半分＋TIME の間隔より長ければ、通信していない間は
// 止まらない。長いほど、子機が親機の送り始めより先に進んでいて遅れて受け取ることが増える（ゲームの待ちより
// 短く）。タブ 2 つで遅れを入れて測り（docs/link-cable-design.md 3.6）、16ms では往復 50ms ほどで通信して
// いない間も 0.57 倍に落ちたので、Wi-Fi の遅れの揺れに備えて 32ms（2 フレームほど）にした
export const WINDOW_MS = 32;
// TIME を送る間隔（ゲーム内）。1 回の linkStep もこの長さで区切る
const TIME_INTERVAL_MS = 4;
const TIME_INTERVAL = TIME_INTERVAL_MS * T_CYCLES_PER_MS;

// 止まってからこれだけたったら「相手を待っています」を出す
const WAITING_NOTICE_MS = 300;
// 相手から何も届かない時間がこれを超えたら「相手から応答がありません」
const SILENCE_MS = 5000;
const PING_INTERVAL_MS = 1000;
// 状態を見直す間隔（待ち・応答なし・ping）
const TICK_MS = 250;

// linkStep の戻り値（core/patches/0003）
const STEP_AUDIO = 0;
const STEP_EVENT = 1;
const STEP_WAITING_REPLY = 2;
const STEP_LIMIT = 3;
// linkTakeEvent の種類
const EVENT_TRANSFER = 0;

export type PeerGame =
    // まだ何も知らない・相手のゲームが止まっている
    | { readonly kind: "none" }
    | {
          readonly kind: "running";
          readonly title: string;
          readonly cgb: boolean;
          readonly paused: boolean;
      };

export type LinkPhase =
    | { readonly kind: "connecting" }
    | { readonly kind: "open" }
    | {
          readonly kind: "closed";
          // bye: 相手が切った、local: 自分で切った、lost: 道が切れた、version: 約束の版が違う
          readonly reason: "bye" | "local" | "lost" | "version";
      };

export interface LinkStatus {
    readonly phase: LinkPhase;
    readonly peer: PeerGame;
    /** 相手を待って止まっている（WAITING_NOTICE_MS 以上） */
    readonly waiting: boolean;
    /** 相手から SILENCE_MS 以上なにも届いていない */
    readonly silent: boolean;
    /** 往復の時間（ms）。まだ測っていなければ null */
    readonly rttMs: number | null;
}

export interface LocalGame {
    readonly title: string;
    readonly cgb: boolean;
}

export type StepOutcome =
    // 音のバッファが 1 つできた（playAudioSamples が呼ばれた）
    | "audio"
    // 区切りまで進んだ。続けて呼んでよい
    | "continue"
    // 相手を待つ。onWake まで呼ばない
    | "stalled";

export class LinkSession {
    private statusValue: LinkStatus = {
        phase: { kind: "connecting" },
        peer: { kind: "none" },
        waiting: false,
        silent: false,
        rttMs: null,
    };
    private readonly listeners = new Set<() => void>();

    // 自分のコアが通信につながっている（ゲームが動いていて、道が開いている）
    private coreActive = false;
    private localGame: LocalGame | null = null;
    private playing = false;
    private epoch = 0;
    private peerTime = 0;
    private lastSentTime = 0;
    private stalledSince: number | null = null;
    private stallCount = 0;
    private stalledMs = 0;
    private lastReceivedAt = performance.now();
    private lastPingAt = 0;
    private readonly ticker: ReturnType<typeof setInterval>;
    private readonly window: number;

    /** 止まっている間に相手のメッセージが届いた。音のループが設定し、続きを走らせる */
    onWake: (() => void) | null = null;

    constructor(
        private readonly transport: LinkTransport,
        private readonly appVersion: string,
        // 相手より先に進んでよい時間（ms、ゲーム内）。試験で変えるときだけ渡す（?linkWindow=）
        windowMs: number = WINDOW_MS,
    ) {
        this.window = windowMs * T_CYCLES_PER_MS;
        transport.onMessage = data => this.receive(data);
        transport.onStateChange = state => this.handleTransportState(state);
        this.ticker = setInterval(() => this.tick(), TICK_MS);
        if (transport.state === "open") this.handleTransportState("open");
    }

    get status(): LinkStatus {
        return this.statusValue;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** 音のループがコアを linkStep で進めるか（道が開いていて、自分のゲームが動いている） */
    get stepping(): boolean {
        return this.coreActive;
    }

    /** 自分のゲームが始まった（info）・止まった（null）。ゲームを始めるたびに、コアを作り直したあとで呼ぶ */
    setLocalGame(info: LocalGame | null): void {
        this.localGame = info;
        if (info && this.statusValue.phase.kind === "open") {
            this.activateCore();
        } else if (!info && this.coreActive) {
            this.coreActive = false;
            this.stalledSince = null;
            this.send({ type: "stop" });
            this.update({ waiting: false });
        }
    }

    /** 自分のゲームが動いている（一時停止していない）か。相手の画面に「一時停止しています」を出すため */
    setPlaying(playing: boolean): void {
        if (playing === this.playing) return;
        this.playing = playing;
        if (!playing) this.stalledSince = null;
        this.send({ type: playing ? "resume" : "pause" });
    }

    /** 自分で切る（「通信を切る」） */
    close(): void {
        this.send({ type: "bye" });
        this.finish("local");
    }

    /**
     * コアを少し進める。音のループの中で、つないでいる間（stepping）だけ呼ぶ。
     * 止まったら、止まる前に自分の時刻を送ってから "stalled" を返す
     */
    step(): StepOutcome {
        const peerLimit = this.peerTime + this.window;
        const start = linkClock();
        const result = linkStep(Math.min(peerLimit, start + TIME_INTERVAL));
        this.sendEvents();
        const now = linkClock();
        if (now > start) this.markProgress();
        if (now - this.lastSentTime >= TIME_INTERVAL) this.sendTime(now);
        switch (result) {
            case STEP_AUDIO:
                return "audio";
            case STEP_EVENT:
                return "continue";
            case STEP_WAITING_REPLY:
                return this.stall(now);
            case STEP_LIMIT:
            default:
                return now >= peerLimit ? this.stall(now) : "continue";
        }
    }

    /** 試験用の数（docs/link-cable-design.md 3.6 を測るため）。開発時は window.__retroboyLink() で読める */
    stats(): {
        readonly clock: number;
        readonly stalls: number;
        readonly stalledMs: number;
    } {
        return {
            clock: this.coreActive ? linkClock() : 0,
            stalls: this.stallCount,
            stalledMs: Math.round(
                this.stalledMs +
                    (this.stalledSince === null
                        ? 0
                        : performance.now() - this.stalledSince),
            ),
        };
    }

    private stall(now: number): StepOutcome {
        if (now > this.lastSentTime) this.sendTime(now);
        if (this.stalledSince === null) {
            this.stalledSince = performance.now();
            this.stallCount += 1;
        }
        return "stalled";
    }

    private markProgress(): void {
        if (this.stalledSince !== null) {
            this.stalledMs += performance.now() - this.stalledSince;
        }
        this.stalledSince = null;
        if (this.statusValue.waiting) this.update({ waiting: false });
    }

    private sendTime(time: number): void {
        this.lastSentTime = time;
        this.send({ type: "time", epoch: this.epoch, time });
    }

    private sendEvents(): void {
        for (;;) {
            const event = linkTakeEvent();
            if (!event) return;
            const [kind, seq, at, byte] = event;
            this.send(
                kind === EVENT_TRANSFER
                    ? { type: "xfer", epoch: this.epoch, seq, at, byte }
                    : { type: "reply", epoch: this.epoch, seq, byte },
            );
        }
    }

    // コアの時刻を 0 にして、相手にもそろえてもらう
    private activateCore(): void {
        if (!this.localGame) return;
        this.epoch += 1;
        linkSetConnected(true);
        this.coreActive = true;
        this.peerTime = 0;
        this.lastSentTime = 0;
        this.stalledSince = null;
        this.send({
            type: "start",
            epoch: this.epoch,
            title: this.localGame.title,
            cgb: this.localGame.cgb,
        });
        this.send({ type: this.playing ? "resume" : "pause" });
    }

    private send(message: LinkMessage): void {
        if (this.transport.state === "open") {
            this.transport.send(encodeMessage(message));
        }
    }

    private receive(data: ArrayBuffer): void {
        const message = decodeMessage(data);
        if (!message) return;
        this.lastReceivedAt = performance.now();
        if (this.statusValue.silent) this.update({ silent: false });
        switch (message.type) {
            case "hello":
                if (message.protocol !== PROTOCOL_VERSION) {
                    this.finish("version");
                }
                return;
            case "start":
                this.update({
                    peer: {
                        kind: "running",
                        title: message.title,
                        cgb: message.cgb,
                        paused: false,
                    },
                });
                if (message.epoch > this.epoch) {
                    this.epoch = message.epoch;
                    if (this.coreActive) {
                        // 相手に合わせて時刻を 0 からやり直す（途中の転送は捨てる）
                        linkSetConnected(true);
                        this.peerTime = 0;
                        this.lastSentTime = 0;
                    }
                }
                this.wake();
                return;
            case "stop":
                this.update({ peer: { kind: "none" } });
                return;
            case "pause":
            case "resume":
                if (this.statusValue.peer.kind === "running") {
                    this.update({
                        peer: {
                            ...this.statusValue.peer,
                            paused: message.type === "pause",
                        },
                    });
                }
                return;
            case "time":
                if (message.epoch === this.epoch && message.time > this.peerTime) {
                    this.peerTime = message.time;
                    this.wake();
                }
                return;
            case "xfer":
                if (this.coreActive && message.epoch === this.epoch) {
                    linkDeliverTransfer(message.seq, message.at, message.byte);
                    // 子機として受け取って返事ができていれば、すぐ送る
                    this.sendEvents();
                    this.wake();
                }
                return;
            case "reply":
                if (this.coreActive && message.epoch === this.epoch) {
                    linkDeliverReply(message.seq, message.byte);
                    this.wake();
                }
                return;
            case "ping":
                this.send({ type: "pong", sentAt: message.sentAt });
                return;
            case "pong":
                this.update({
                    rttMs: Math.round(performance.now() - message.sentAt),
                });
                return;
            case "bye":
                this.finish("bye");
                return;
        }
    }

    private wake(): void {
        if (this.stalledSince !== null) this.onWake?.();
    }

    private handleTransportState(state: TransportState): void {
        if (state === "open" && this.statusValue.phase.kind === "connecting") {
            this.lastReceivedAt = performance.now();
            this.update({ phase: { kind: "open" } });
            this.send({
                type: "hello",
                protocol: PROTOCOL_VERSION,
                app: this.appVersion,
            });
            this.activateCore();
        } else if (state === "closed") {
            this.finish("lost");
        }
    }

    private finish(reason: "bye" | "local" | "lost" | "version"): void {
        if (this.statusValue.phase.kind === "closed") return;
        clearInterval(this.ticker);
        if (this.coreActive) {
            // ゲームはそのまま続ける（コアはつながっていない状態に戻り、親機は 0xFF を受け取る）
            linkSetConnected(false);
            this.coreActive = false;
        }
        this.transport.onMessage = null;
        this.transport.onStateChange = null;
        this.transport.close();
        this.update({
            phase: { kind: "closed", reason },
            waiting: false,
            silent: false,
        });
        // 止まっていた音のループを、つながっていないときの回し方で再開させる
        this.onWake?.();
    }

    private tick(): void {
        if (this.statusValue.phase.kind !== "open") return;
        const now = performance.now();
        if (now - this.lastPingAt >= PING_INTERVAL_MS) {
            this.lastPingAt = now;
            this.send({ type: "ping", sentAt: now });
        }
        const waiting =
            this.stalledSince !== null &&
            now - this.stalledSince >= WAITING_NOTICE_MS;
        const silent = now - this.lastReceivedAt >= SILENCE_MS;
        if (
            waiting !== this.statusValue.waiting ||
            silent !== this.statusValue.silent
        ) {
            this.update({ waiting, silent });
        }
    }

    private update(change: Partial<LinkStatus>): void {
        this.statusValue = { ...this.statusValue, ...change };
        this.listeners.forEach(listener => listener());
    }
}
