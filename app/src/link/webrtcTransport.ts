// 同じ Wi-Fi の 2 台を WebRTC の DataChannel で直接つなぐ道（docs/link-cable-design.md 4 章）。
// STUN / TURN は使わない（iceServers を空にする）ので、候補は同じネットワークの中の自分のアドレスだけ。
// 最初の接続情報は、候補を集め終えてからまとめてコード（signal.ts）にし、QR かコピー・貼り付けで渡す
// （相手のサーバーが無いので、あとから候補を足して送ること〔トリクル〕はできない）。
//
// 先に始める側（host）: createHost() → 出たコードを相手に見せる → 相手のコードを acceptAnswer() に渡す
// あとから読む側（guest）: createGuest(相手のコード) → 出たコードを相手に見せる → つながるのを待つ
import { decodeSignal, encodeSignal } from "./signal";
import type { LinkTransport, TransportState } from "./transport";

// 候補を集め終えるのを待つ上限。STUN が無いので普通は 1 秒かからない。来なければ、そこまでの候補で進める
const GATHER_TIMEOUT_MS = 3000;
// 最初の候補が出てから、残りの候補を待つ時間。WebKit は集め終えた（complete）ことを知らせないことがあり、
// 上限まで待つと、そのあとつながらなくなることがあった（Playwright の WebKit）
const GATHER_SETTLE_MS = 500;

// 相手の SDP を、候補の行を抜いた SDP と、候補に分ける。候補は setRemoteDescription のあとで addIceCandidate
// で足す（SDP の中の候補のままでは、Playwright の Chromium でつながらなかった。同じ候補を足し直すとつながった）
const splitCandidates = (
    sdp: string,
): { readonly sdp: string; readonly candidates: string[]; readonly mid: string } => {
    const lines = sdp.split("\r\n");
    return {
        sdp: lines.filter(line => !line.startsWith("a=candidate:")).join("\r\n"),
        candidates: lines
            .filter(line => line.startsWith("a=candidate:"))
            .map(line => line.slice("a=".length)),
        mid: lines.find(line => line.startsWith("a=mid:"))?.slice("a=mid:".length) ?? "0",
    };
};

export class WebRtcTransport implements LinkTransport {
    state: TransportState = "connecting";
    onMessage: ((data: ArrayBuffer) => void) | null = null;
    onStateChange: ((state: TransportState) => void) | null = null;

    private readonly peer = new RTCPeerConnection({ iceServers: [] });
    private channel: RTCDataChannel | null = null;

    private constructor() {
        this.peer.onconnectionstatechange = () => {
            const state = this.peer.connectionState;
            if (state === "failed" || state === "closed") this.finish();
        };
    }

    /** 先に始める側。DataChannel を作って offer のコードを作る */
    static async createHost(): Promise<{
        readonly transport: WebRtcTransport;
        readonly code: string;
    }> {
        const transport = new WebRtcTransport();
        try {
            transport.attach(
                transport.peer.createDataChannel("link", { ordered: true }),
            );
            await transport.peer.setLocalDescription(
                await transport.peer.createOffer(),
            );
            const code = await encodeSignal(
                "offer",
                await transport.gatheredSdp(),
            );
            return { transport, code };
        } catch (err) {
            transport.close();
            throw err;
        }
    }

    /** あとから読む側。相手の offer のコードから answer のコードを作る（読めなければ SignalError） */
    static async createGuest(offerCode: string): Promise<{
        readonly transport: WebRtcTransport;
        readonly code: string;
    }> {
        const offer = await decodeSignal(offerCode, "offer");
        const transport = new WebRtcTransport();
        try {
            transport.peer.ondatachannel = event =>
                transport.attach(event.channel);
            const remote = splitCandidates(offer);
            await transport.peer.setRemoteDescription({ type: "offer", sdp: remote.sdp });
            await transport.peer.setLocalDescription(
                await transport.peer.createAnswer(),
            );
            // 自分の候補が出始めるのを見逃さないよう、相手の候補を足す前から待ち始める
            const gathered = transport.gatheredSdp();
            await transport.addCandidates(remote);
            const code = await encodeSignal("answer", await gathered);
            return { transport, code };
        } catch (err) {
            transport.close();
            throw err;
        }
    }

    /** 先に始めた側が、相手の answer のコードを受け取る（読めなければ SignalError） */
    async acceptAnswer(answerCode: string): Promise<void> {
        const remote = splitCandidates(await decodeSignal(answerCode, "answer"));
        await this.peer.setRemoteDescription({ type: "answer", sdp: remote.sdp });
        await this.addCandidates(remote);
    }

    private async addCandidates(remote: {
        readonly candidates: string[];
        readonly mid: string;
    }): Promise<void> {
        for (const candidate of remote.candidates) {
            // 使えない候補（相手の環境だけのもの）は飛ばす。残りでつながればよい
            await this.peer
                .addIceCandidate({ candidate, sdpMid: remote.mid, sdpMLineIndex: 0 })
                .catch((err: unknown) => console.warn("addIceCandidate failed:", err));
        }
    }

    send(data: ArrayBuffer): void {
        if (this.channel?.readyState === "open") this.channel.send(data);
    }

    close(): void {
        if (this.state === "closed") return;
        // 送り待ちのもの（切る前の bye など）を出し切ってから閉じる
        const channel = this.channel;
        if (channel && channel.readyState === "open" && channel.bufferedAmount > 0) {
            channel.bufferedAmountLowThreshold = 0;
            channel.onbufferedamountlow = () => this.peer.close();
            setTimeout(() => this.peer.close(), 1000);
        } else {
            this.peer.close();
        }
        this.finish();
    }

    private attach(channel: RTCDataChannel): void {
        this.channel = channel;
        channel.binaryType = "arraybuffer";
        channel.onopen = () => this.setState("open");
        channel.onclose = () => this.finish();
        channel.onmessage = event => {
            if (event.data instanceof ArrayBuffer) this.onMessage?.(event.data);
        };
    }

    // 候補を集め終えた（か、待ちの上限が来た）ときの SDP
    private async gatheredSdp(): Promise<string> {
        if (this.peer.iceGatheringState !== "complete") {
            await new Promise<void>(resolve => {
                const peer = this.peer;
                let timer = setTimeout(done, GATHER_TIMEOUT_MS);
                let sawCandidate = false;
                function done() {
                    clearTimeout(timer);
                    peer.removeEventListener("icegatheringstatechange", check);
                    peer.removeEventListener("icecandidate", candidate);
                    resolve();
                }
                function check() {
                    if (peer.iceGatheringState === "complete") done();
                }
                function candidate(event: RTCPeerConnectionIceEvent) {
                    if (!event.candidate) {
                        done();
                    } else if (!sawCandidate) {
                        sawCandidate = true;
                        clearTimeout(timer);
                        timer = setTimeout(done, GATHER_SETTLE_MS);
                    }
                }
                peer.addEventListener("icegatheringstatechange", check);
                peer.addEventListener("icecandidate", candidate);
            });
        }
        const sdp = this.peer.localDescription?.sdp;
        if (!sdp) throw new Error("接続情報を作れませんでした");
        return sdp;
    }

    private finish(): void {
        if (this.state === "closed") return;
        this.setState("closed");
    }

    private setState(state: TransportState): void {
        if (this.state === state) return;
        this.state = state;
        this.onStateChange?.(state);
    }
}
