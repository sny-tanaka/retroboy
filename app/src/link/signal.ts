// WebRTC の最初の接続情報（offer / answer の SDP）を、QR やコピー・貼り付けで渡せる短い文字列（コード）にする。
// 形: "RBL1" ＋ 種類（O = offer、A = answer）＋ SDP を deflate-raw で縮めて base32（0-9A-V）にしたもの。
// 文字は全部 QR の英数字モードに入るもの（数字と英大文字）にして、QR を小さくする（base64 を 8 ビットの
// バイトモードで入れるより 2 割ほど少ない）。記号が無いので、コピー・貼り付けでも崩れにくい。
// さらに、DataChannel に要らない行・同じ Wi-Fi でつなぐのに使わない候補（TCP）・候補の付け足しの情報を落とす。
// 縮めるのは CompressionStream（iOS 16.4 以降・Chrome・Firefox）。

const PREFIX = "RBL1";

export type SignalKind = "offer" | "answer";

const KIND_CODES: Record<SignalKind, string> = { offer: "O", answer: "A" };

export class SignalError extends Error {}

// SDP から落とす行。DataChannel だけ・同じ Wi-Fi の中だけなので、無くてもつながる
const isDroppable = (line: string): boolean =>
    // TCP の候補（同じ Wi-Fi では UDP でつながる）
    (line.startsWith("a=candidate:") && / tcp /i.test(line)) ||
    line.startsWith("a=extmap-allow-mixed") ||
    line.startsWith("a=msid-semantic") ||
    line.startsWith("a=ice-options:");

export const minifySdp = (sdp: string): string =>
    sdp
        .split(/\r?\n/)
        .filter(line => line !== "" && !isDroppable(line))
        // 候補の後ろの付け足し（generation・network-id・network-cost）は、つなぐのには使わない
        .map(line =>
            line.startsWith("a=candidate:")
                ? line.replace(/ (generation|network-id|network-cost) \S+/g, "")
                : line,
        )
        .join("\r\n") + "\r\n";

// base32（RFC 4648 の base32hex、= は付けない）
const BASE32 = "0123456789ABCDEFGHIJKLMNOPQRSTUV";

const toBase32 = (bytes: Uint8Array): string => {
    let text = "";
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            text += BASE32[(buffer >> bits) & 31];
        }
        buffer &= (1 << bits) - 1;
    }
    if (bits > 0) text += BASE32[(buffer << (5 - bits)) & 31];
    return text;
};

const fromBase32 = (text: string): Uint8Array => {
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (const char of text) {
        const value = BASE32.indexOf(char);
        if (value < 0) throw new Error(`not base32: ${char}`);
        buffer = (buffer << 5) | value;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((buffer >> bits) & 0xff);
        }
        buffer &= (1 << bits) - 1;
    }
    return new Uint8Array(bytes);
};

const transform = async (
    bytes: Uint8Array,
    stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> => {
    const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(output).arrayBuffer());
};

export const encodeSignal = async (
    kind: SignalKind,
    sdp: string,
): Promise<string> => {
    const compressed = await transform(
        new TextEncoder().encode(minifySdp(sdp)),
        new CompressionStream("deflate-raw"),
    );
    return PREFIX + KIND_CODES[kind] + toBase32(compressed);
};

/** コードを SDP に戻す。expected と種類が違う・読めないときは SignalError（文言はそのまま画面に出す） */
export const decodeSignal = async (
    code: string,
    expected: SignalKind,
): Promise<string> => {
    // 貼り付けで入った空白・改行と、小文字にされたものは許す
    const text = code.replace(/\s+/g, "").toUpperCase();
    if (!text.startsWith(PREFIX)) {
        throw new SignalError("通信ケーブルのコードではありません。");
    }
    const kind = text.charAt(PREFIX.length);
    if (kind !== KIND_CODES[expected]) {
        throw new SignalError(
            expected === "answer"
                ? "これは「QR を出す」側のコードです。相手の画面に出ている QR（コード）を読んでください。"
                : "これは「QR を読む」側のコードです。先に「QR を出す」を押した方の QR（コード）を読んでください。",
        );
    }
    try {
        const bytes = await transform(
            fromBase32(text.slice(PREFIX.length + 1)),
            new DecompressionStream("deflate-raw"),
        );
        const sdp = new TextDecoder().decode(bytes);
        if (!sdp.startsWith("v=0")) throw new Error("not sdp");
        return sdp;
    } catch {
        throw new SignalError(
            "コードを読めませんでした。途中で切れていないか確かめてください。",
        );
    }
};
