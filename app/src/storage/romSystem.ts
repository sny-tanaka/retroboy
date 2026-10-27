// ROM がどの本体のものか（どのコアで動かすか）。GB / GBC は Retro Boy、GBA は mGBA（app/src/gba/）。
// 決め方: 名前が .gba か、ヘッダが GBA の形（3 バイト目が ARM の分岐の 0xEA、0xB2 が 0x96）なら GBA。
// それ以外は Game Boy（GB か GBC かは useRomSession.ts の detectMode がヘッダで決める）。

export type RomSystem = "gb" | "gba";

const GBA_HEADER_SIZE = 0xc0;

export const isGbaHeader = (data: ArrayBuffer): boolean => {
    if (data.byteLength < GBA_HEADER_SIZE) return false;
    const bytes = new Uint8Array(data, 0, GBA_HEADER_SIZE);
    return bytes[3] === 0xea && bytes[0xb2] === 0x96;
};

export const detectRomSystem = (name: string, data: ArrayBuffer): RomSystem =>
    name.toLowerCase().endsWith(".gba") || isGbaHeader(data) ? "gba" : "gb";

// 受け付ける大きさ（app/plugins/builtinGames.ts も同じ値を使う）
export const MIN_ROM_SIZE = 0x150; // Game Boy のカートリッジヘッダの終わり（GBA のヘッダはこれより短い）
export const MAX_GB_ROM_SIZE = 8 * 1024 * 1024; // Game Boy の ROM の最大（MBC5 の 8MB）
export const MAX_GBA_ROM_SIZE = 32 * 1024 * 1024; // GBA の ROM の最大（32MB）
