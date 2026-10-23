// ROM の ID = 中身の SHA-256（16 進の小文字）。同じ中身なら同じ ID、名前が同じでも中身が違えば別の ID。
export const computeRomId = async (data: ArrayBuffer): Promise<string> => {
    // crypto.subtle は安全なコンテキスト（HTTPS か localhost）でしか使えない
    if (!globalThis.crypto?.subtle) {
        throw new Error("crypto.subtle is not available (not a secure context)");
    }
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), byte =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
};
