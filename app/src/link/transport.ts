// 通信ケーブルの道。メッセージ（バイト列）を相手に順番どおり、落とさずに届ける。
// いまは同じブラウザのタブどうしをつなぐ試験用の道（BroadcastChannel）と、わざと遅らせる部品だけ。
// 同じ Wi-Fi の 2 台をつなぐ WebRTC の道は PR ③ で足す（docs/link-cable-design.md 4 章）。

export type TransportState = "connecting" | "open" | "closed";

export interface LinkTransport {
    readonly state: TransportState;
    send(data: ArrayBuffer): void;
    close(): void;
    /** 相手からのメッセージ */
    onMessage: ((data: ArrayBuffer) => void) | null;
    /** state が変わった */
    onStateChange: ((state: TransportState) => void) | null;
}

type TabPacket =
    // 「ここにいる」。相手を探している間に出す
    | { readonly kind: "announce"; readonly from: string }
    // announce を受けて、相手になった
    | { readonly kind: "accept"; readonly from: string; readonly to: string }
    | {
          readonly kind: "data";
          readonly from: string;
          readonly to: string;
          readonly data: ArrayBuffer;
      }
    | { readonly kind: "leave"; readonly from: string; readonly to: string };

/**
 * 同じブラウザ（同じオリジン）のタブどうしをつなぐ試験用の道。同じ room の、最初に見つけたタブ 1 つとつながる
 * （3 つ目のタブは相手が空くまで待つ）。タブを閉じると相手には切れたと届く。
 */
export class TabTransport implements LinkTransport {
    state: TransportState = "connecting";
    onMessage: ((data: ArrayBuffer) => void) | null = null;
    onStateChange: ((state: TransportState) => void) | null = null;

    private readonly id = crypto.randomUUID();
    private readonly channel: BroadcastChannel;
    private peer: string | null = null;
    private readonly handlePageHide = () => this.close();

    constructor(room: string) {
        this.channel = new BroadcastChannel(`retroboy-snap-link:${room}`);
        this.channel.onmessage = event =>
            this.receive(event.data as TabPacket);
        window.addEventListener("pagehide", this.handlePageHide);
        this.post({ kind: "announce", from: this.id });
    }

    send(data: ArrayBuffer): void {
        if (this.state !== "open" || !this.peer) return;
        this.post({ kind: "data", from: this.id, to: this.peer, data });
    }

    close(): void {
        if (this.state === "closed") return;
        if (this.peer) {
            this.post({ kind: "leave", from: this.id, to: this.peer });
        }
        window.removeEventListener("pagehide", this.handlePageHide);
        this.channel.close();
        this.setState("closed");
    }

    private post(packet: TabPacket): void {
        this.channel.postMessage(packet);
    }

    private setState(state: TransportState): void {
        this.state = state;
        this.onStateChange?.(state);
    }

    private receive(packet: TabPacket): void {
        if (this.state === "closed") return;
        switch (packet.kind) {
            case "announce":
                if (this.peer === null) {
                    this.peer = packet.from;
                    this.post({ kind: "accept", from: this.id, to: packet.from });
                    this.setState("open");
                }
                return;
            case "accept":
                if (packet.to === this.id && this.peer === null) {
                    this.peer = packet.from;
                    this.setState("open");
                }
                return;
            case "data":
                if (packet.to === this.id && packet.from === this.peer) {
                    this.onMessage?.(packet.data);
                }
                return;
            case "leave":
                if (packet.to === this.id && packet.from === this.peer) {
                    window.removeEventListener("pagehide", this.handlePageHide);
                    this.channel.close();
                    this.setState("closed");
                }
                return;
        }
    }
}

/**
 * 送るものをわざと遅らせる（試験用。docs/link-cable-design.md 5 章）。delayMs は片道の遅れ、jitterMs はそれに
 * 足す揺れの最大。揺れがあっても順番は崩さない（前に送ったものより先には届けない）。
 */
export class DelayedTransport implements LinkTransport {
    onMessage: ((data: ArrayBuffer) => void) | null = null;
    onStateChange: ((state: TransportState) => void) | null = null;
    private lastDeliverAt = 0;

    constructor(
        private readonly inner: LinkTransport,
        private readonly delayMs: number,
        private readonly jitterMs: number,
    ) {
        inner.onMessage = data => this.onMessage?.(data);
        inner.onStateChange = state => this.onStateChange?.(state);
    }

    get state(): TransportState {
        return this.inner.state;
    }

    send(data: ArrayBuffer): void {
        const now = performance.now();
        const deliverAt = Math.max(
            this.lastDeliverAt,
            now + this.delayMs + Math.random() * this.jitterMs,
        );
        this.lastDeliverAt = deliverAt;
        setTimeout(() => this.inner.send(data), deliverAt - now);
    }

    // 遅らせているものを届け終えてから閉じる（切る前に送った bye を先に届ける）
    close(): void {
        const wait = this.lastDeliverAt - performance.now();
        if (wait > 0) {
            setTimeout(() => this.inner.close(), wait);
        } else {
            this.inner.close();
        }
    }
}
