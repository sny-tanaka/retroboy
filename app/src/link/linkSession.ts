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
// 予約せずに抜け、相手のメッセージが届いたら onWake で呼び直してもらう。GBA は useGbaLoop.ts が同じように回す。
//
// コアは Game Boy（Retro Boy）でも GBA（mGBA）でもよい（linkCore.ts の LinkCore。docs/link-cable-design.md 8 章）。
// 時刻の単位はコアごとに違うので、ms で決めた長さはそのときのコアの cyclesPerMs で直す。
import {
    type LinkCore,
    type LinkSystem,
    sameLinkFamily,
    STEP_AUDIO,
    STEP_EVENT,
    STEP_LIMIT,
    STEP_WAITING_REPLY,
} from "./linkCore";
import {
    decodeMessage,
    encodeMessage,
    type LinkMessage,
    PROTOCOL_VERSION,
} from "./protocol";
import type { LinkTransport, TransportState } from "./transport";

// 相手より先に進んでよい時間（ゲーム内）。往復の時間の半分＋TIME の間隔より長ければ、通信していない間は
// 止まらない。長いほど、子機が親機の送り始めより先に進んでいて遅れて受け取ることが増える（ゲームの待ちより
// 短く）。タブ 2 つで遅れを入れて測り（docs/link-cable-design.md 3.6）、16ms では往復 50ms ほどで通信して
// いない間も 0.57 倍に落ちたので、Wi-Fi の遅れの揺れに備えて 32ms（2 フレームほど）にした
export const WINDOW_MS = 32;
// TIME を送る間隔（ゲーム内）。1 回の linkStep もこの長さで区切る
const TIME_INTERVAL_MS = 4;

// 止まってからこれだけたったら「相手を待っています」を出す
const WAITING_NOTICE_MS = 300;
// 相手から何も届かない時間がこれを超えたら「相手から応答がありません」
const SILENCE_MS = 5000;
const PING_INTERVAL_MS = 1000;
// 状態を見直す間隔（待ち・応答なし・ping）
const TICK_MS = 250;

export type PeerGame =
    // まだ何も知らない・相手のゲームが止まっている
    | { readonly kind: "none" }
    | {
          readonly kind: "running";
          readonly title: string;
          readonly system: LinkSystem;
          readonly paused: boolean;
          /** 通信できない機械の組（GBA と GB・GBC）。進みは合わせない */
          readonly mismatch: boolean;
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
    readonly system: LinkSystem;
    /** このゲームを動かしているコア */
    readonly core: LinkCore;
}

export type StepOutcome =
    // 音のバッファが 1 つできた（Game Boy は playAudioSamples が呼ばれた。GBA は 1 フレーム進んだ）
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

    // 通信につないでいる自分のコア（ゲームが動いていて、道が開いている間）
    private activeCore: LinkCore | null = null;
    private localGame: LocalGame | null = null;
    private playing = false;
    private epoch = 0;
    private peerTime = 0;
    private lastSentTime = 0;
    private stalledSince: number | null = null;
    private stallCount = 0;
    // 送った・受け取った転送の数（試験で 1 秒あたりの転送の数を測るため）
    private transferCount = 0;
    private stalledMs = 0;
    // つないでいる間に押したボタンと、そのときのコアの時刻
    private readonly pressedAt = new Map<string, number>();
    // 離すのを遅らせているボタンと、離す時刻
    private readonly pendingReleases = new Map<string, number>();
    private lastReceivedAt = performance.now();
    private lastPingAt = 0;
    private readonly ticker: ReturnType<typeof setInterval>;
    private readonly windowMs: number;

    /** 止まっている間に相手のメッセージが届いた。音のループが設定し、続きを走らせる */
    onWake: (() => void) | null = null;

    constructor(
        private readonly transport: LinkTransport,
        private readonly appVersion: string,
        // 相手より先に進んでよい時間（ms、ゲーム内）。試験で変えるときだけ渡す（?linkWindow=）
        windowMs: number = WINDOW_MS,
    ) {
        this.windowMs = windowMs;
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
        return this.activeCore !== null;
    }

    /** 自分のゲームが始まった（info）・止まった（null）。ゲームを始めるたびに、コアを作り直したあとで呼ぶ */
    setLocalGame(info: LocalGame | null): void {
        this.localGame = info;
        const peer = this.statusValue.peer;
        if (info && peer.kind === "running") {
            this.update({
                peer: {
                    ...peer,
                    mismatch: !sameLinkFamily(info.system, peer.system),
                },
            });
        }
        if (info && this.statusValue.phase.kind === "open") {
            this.activateCore();
        } else if (!info && this.activeCore) {
            this.resetKeys();
            this.activeCore = null;
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
        const core = this.activeCore;
        if (!core) return "continue";
        const timeInterval = TIME_INTERVAL_MS * core.cyclesPerMs;
        // 通信できない機械の組なら、相手を待たない（ゲームはつながっていないのと同じに見える）
        const peerLimit = this.peerMismatch()
            ? Infinity
            : this.peerTime + this.windowMs * core.cyclesPerMs;
        const start = core.clock();
        const result = core.step(Math.min(peerLimit, start + timeInterval));
        this.sendEvents();
        this.releaseDueKeys();
        const now = core.clock();
        if (now > start) this.markProgress();
        if (now - this.lastSentTime >= timeInterval) this.sendTime(now);
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

    /** ボタンを押した（emulator/gameKeys.ts）。離すのを遅らせるために、押した時刻を覚える */
    notePress(key: string): void {
        if (!this.activeCore) return;
        this.pendingReleases.delete(key);
        this.pressedAt.set(key, this.activeCore.clock());
    }

    /**
     * ボタンを離した。押してからゲームの中で 1 フレーム進んでいなければ、離すのをそこまで遅らせて true を返す
     * （コアにはまだ伝えない）。false ならすぐ伝えてよい
     */
    deferRelease(key: string): boolean {
        const pressedAt = this.pressedAt.get(key);
        this.pressedAt.delete(key);
        const core = this.activeCore;
        if (!core || pressedAt === undefined) return false;
        const releaseAt = pressedAt + core.frameCycles;
        if (core.clock() >= releaseAt) return false;
        this.pendingReleases.set(key, releaseAt);
        return true;
    }

    // 遅らせていたボタンのうち、時刻が来たもの（force なら全部）を離す
    private releaseDueKeys(force = false): void {
        const core = this.activeCore;
        if (this.pendingReleases.size === 0 || !core) return;
        const now = force ? Infinity : core.clock();
        this.pendingReleases.forEach((releaseAt, key) => {
            if (now >= releaseAt) {
                this.pendingReleases.delete(key);
                core.releaseKey(key);
            }
        });
    }

    // コアの時刻が 0 に戻る・通信から外れるとき。遅らせていたボタンは離し、押した時刻は忘れる
    private resetKeys(): void {
        this.releaseDueKeys(true);
        this.pressedAt.clear();
    }

    /** 試験用の数（docs/link-cable-design.md 3.6 を測るため）。開発時は window.__retroboyLink() で読める */
    stats(): {
        readonly clock: number;
        readonly stalls: number;
        readonly transfers: number;
        readonly stalledMs: number;
        readonly pressedKeys: readonly string[];
        readonly pendingReleases: readonly string[];
    } {
        return {
            clock: this.activeCore?.clock() ?? 0,
            stalls: this.stallCount,
            transfers: this.transferCount,
            pressedKeys: [...this.pressedAt.keys()],
            pendingReleases: [...this.pendingReleases.keys()],
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
        const core = this.activeCore;
        if (!core) return;
        const epoch = this.epoch;
        for (;;) {
            const event = core.takeEvent();
            if (!event) return;
            switch (event.kind) {
                case "transfer":
                    this.transferCount += 1;
                    this.send({ type: "xfer", epoch, ...event });
                    break;
                case "reply":
                    this.send({ type: "reply", epoch, ...event });
                    break;
                case "so":
                    this.send({ type: "so", epoch, ...event });
                    break;
            }
        }
    }

    // コアの時刻を 0 にして、相手にもそろえてもらう
    private activateCore(): void {
        if (!this.localGame) return;
        this.epoch += 1;
        this.resetKeys();
        this.activeCore = this.localGame.core;
        this.activeCore.setConnected(true);
        this.peerTime = 0;
        this.lastSentTime = 0;
        this.stalledSince = null;
        this.send({
            type: "start",
            epoch: this.epoch,
            title: this.localGame.title,
            system: this.localGame.system,
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
                        system: message.system,
                        paused: false,
                        mismatch:
                            this.localGame !== null &&
                            !sameLinkFamily(
                                this.localGame.system,
                                message.system,
                            ),
                    },
                });
                if (message.epoch > this.epoch) {
                    this.epoch = message.epoch;
                    if (this.activeCore) {
                        // 相手に合わせて時刻を 0 からやり直す（途中の転送は捨てる）
                        this.resetKeys();
                        this.activeCore.setConnected(true);
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
                if (this.activeCore && this.acceptsData(message.epoch)) {
                    this.transferCount += 1;
                    this.activeCore.deliverTransfer(
                        message.seq,
                        message.at,
                        message.data,
                        message.bits,
                    );
                    // 子機として受け取って返事ができていれば、すぐ送る
                    this.sendEvents();
                    this.wake();
                }
                return;
            case "reply":
                if (this.activeCore && this.acceptsData(message.epoch)) {
                    this.activeCore.deliverReply(message.seq, message.data);
                    this.wake();
                }
                return;
            case "so":
                if (this.activeCore && this.acceptsData(message.epoch)) {
                    this.activeCore.deliverSo(message.at, message.level);
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

    // 相手が通信できない機械のゲームを動かしている（GBA と GB・GBC）
    private peerMismatch(): boolean {
        const peer = this.statusValue.peer;
        return peer.kind === "running" && peer.mismatch;
    }

    // 相手の転送・返事をコアに渡してよいか（同じ epoch で、通信できる機械の組）
    private acceptsData(epoch: number): boolean {
        return epoch === this.epoch && !this.peerMismatch();
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
        if (this.activeCore) {
            // ゲームはそのまま続ける（コアはつながっていない状態に戻り、親機は 0xFF を受け取る）
            this.resetKeys();
            this.activeCore.setConnected(false);
            this.activeCore = null;
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
