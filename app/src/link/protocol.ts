// 通信ケーブルで 2 台が送り合うメッセージと、そのバイト列への変換（docs/link-cable-design.md 3.1）。
// 道（transport.ts）はバイト列（ArrayBuffer）をそのまま順番どおりに届ける。
//
// 時刻はどれも、コアの通信用の時刻（4MHz の T サイクル。linkClock()）。2^53 までは number で正確に持てる。
// epoch は、両方のコアが時刻を 0 からそろえ直すたびに 1 増える番号。古い epoch の TIME・XFER・REPLY は捨てる
// （そろえ直す前に送られて、まだ届いていなかったもの）。

// 約束の版。メッセージの形を変えたら上げる（違う版どうしはつながない）
export const PROTOCOL_VERSION = 1;

export type LinkMessage =
    // つながった直後に 1 回。アプリの版は知らせるだけ
    | { readonly type: "hello"; readonly protocol: number; readonly app: string }
    // コアを通信につないだ（時刻を 0 にした）。受けた側も自分のコアの時刻を 0 にして epoch をそろえる。
    // title は相手の画面に出す ROM のタイトル
    | {
          readonly type: "start";
          readonly epoch: number;
          readonly title: string;
          readonly cgb: boolean;
      }
    // コアを通信から外した（ROM を止めた・切り替えた）
    | { readonly type: "stop" }
    // 「時刻 time まで進んだ」
    | { readonly type: "time"; readonly epoch: number; readonly time: number }
    // 親機が送り始めた。相手は at に受け取る
    | {
          readonly type: "xfer";
          readonly epoch: number;
          readonly seq: number;
          readonly at: number;
          readonly byte: number;
      }
    // 子機の返事
    | {
          readonly type: "reply";
          readonly epoch: number;
          readonly seq: number;
          readonly byte: number;
      }
    // 一時停止した・戻った（相手の画面に「相手が一時停止しています」を出すため）
    | { readonly type: "pause" }
    | { readonly type: "resume" }
    // 往復の時間を測る。sentAt は送った側の performance.now()
    | { readonly type: "ping"; readonly sentAt: number }
    | { readonly type: "pong"; readonly sentAt: number }
    // 切る
    | { readonly type: "bye" };

const TYPE_CODES = {
    hello: 1,
    start: 2,
    stop: 3,
    time: 4,
    xfer: 5,
    reply: 6,
    pause: 7,
    resume: 8,
    ping: 9,
    pong: 10,
    bye: 11,
} as const satisfies Record<LinkMessage["type"], number>;

const TYPE_NAMES = Object.fromEntries(
    Object.entries(TYPE_CODES).map(([name, code]) => [code, name]),
) as Record<number, LinkMessage["type"]>;

// 文字列は長さ（u16）＋ UTF-8
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class Writer {
    private readonly bytes: number[] = [];
    u8(value: number): this {
        this.bytes.push(value & 0xff);
        return this;
    }
    u16(value: number): this {
        return this.u8(value).u8(value >> 8);
    }
    u32(value: number): this {
        return this.u16(value & 0xffff).u16(value >>> 16);
    }
    f64(value: number): this {
        const view = new DataView(new ArrayBuffer(8));
        view.setFloat64(0, value, true);
        for (let i = 0; i < 8; i++) this.u8(view.getUint8(i));
        return this;
    }
    text(value: string): this {
        const encoded = textEncoder.encode(value).slice(0, 0xffff);
        this.u16(encoded.length);
        encoded.forEach(byte => this.u8(byte));
        return this;
    }
    finish(): ArrayBuffer {
        return new Uint8Array(this.bytes).buffer;
    }
}

class Reader {
    private offset = 0;
    private readonly view: DataView;
    constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
    }
    private take(size: number): number {
        if (this.offset + size > this.view.byteLength) {
            throw new Error("通信のメッセージが短すぎます");
        }
        const at = this.offset;
        this.offset += size;
        return at;
    }
    u8(): number {
        return this.view.getUint8(this.take(1));
    }
    u16(): number {
        return this.view.getUint16(this.take(2), true);
    }
    u32(): number {
        return this.view.getUint32(this.take(4), true);
    }
    f64(): number {
        return this.view.getFloat64(this.take(8), true);
    }
    text(): string {
        const length = this.u16();
        const at = this.take(length);
        return textDecoder.decode(
            new Uint8Array(this.view.buffer, this.view.byteOffset + at, length),
        );
    }
}

export const encodeMessage = (message: LinkMessage): ArrayBuffer => {
    const writer = new Writer().u8(TYPE_CODES[message.type]);
    switch (message.type) {
        case "hello":
            return writer.u16(message.protocol).text(message.app).finish();
        case "start":
            return writer
                .u32(message.epoch)
                .text(message.title)
                .u8(message.cgb ? 1 : 0)
                .finish();
        case "time":
            return writer.u32(message.epoch).f64(message.time).finish();
        case "xfer":
            return writer
                .u32(message.epoch)
                .u32(message.seq)
                .f64(message.at)
                .u8(message.byte)
                .finish();
        case "reply":
            return writer
                .u32(message.epoch)
                .u32(message.seq)
                .u8(message.byte)
                .finish();
        case "ping":
        case "pong":
            return writer.f64(message.sentAt).finish();
        case "stop":
        case "pause":
        case "resume":
        case "bye":
            return writer.finish();
    }
};

/** 読めないメッセージは null（知らない種類・短すぎる） */
export const decodeMessage = (buffer: ArrayBuffer): LinkMessage | null => {
    try {
        const reader = new Reader(buffer);
        const type = TYPE_NAMES[reader.u8()];
        switch (type) {
            case "hello":
                return { type, protocol: reader.u16(), app: reader.text() };
            case "start":
                return {
                    type,
                    epoch: reader.u32(),
                    title: reader.text(),
                    cgb: reader.u8() !== 0,
                };
            case "time":
                return { type, epoch: reader.u32(), time: reader.f64() };
            case "xfer":
                return {
                    type,
                    epoch: reader.u32(),
                    seq: reader.u32(),
                    at: reader.f64(),
                    byte: reader.u8(),
                };
            case "reply":
                return {
                    type,
                    epoch: reader.u32(),
                    seq: reader.u32(),
                    byte: reader.u8(),
                };
            case "ping":
            case "pong":
                return { type, sentAt: reader.f64() };
            case "stop":
            case "pause":
            case "resume":
            case "bye":
                return { type };
            default:
                return null;
        }
    } catch {
        return null;
    }
};
