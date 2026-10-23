// 出どころ: smparsons/retroboy frontends/web/src/cartridgeEffects.ts
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: lodash/debounce を小さな debounce に置き換え、window への代入に型を付けた。
//   保存先（localStorage）・キー・形式は本家と同じ。詳しくは docs/upstream-notes.md。
import { WasmRTCState } from "../core/retroboyCore";

const DEBOUNCE_DELAY = 2000;

// lodash/debounce の trailing 呼び出しだけを再現したもの（最後の引数で 1 回だけ実行する）
const debounce = <Args extends unknown[]>(
    fn: (...args: Args) => void,
    wait: number,
): ((...args: Args) => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (...args: Args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
};

const currentTimeMillis = () => Date.now();

const loadRTCState = (key: string): WasmRTCState | null => {
    const item = localStorage.getItem(key);
    if (item) {
        const parsed = JSON.parse(item);
        return new WasmRTCState(
            parsed.milliseconds,
            parsed.seconds,
            parsed.minutes,
            parsed.hours,
            parsed.days,
            parsed.base_timestamp,
            parsed.halted,
            parsed.day_carry,
        );
    }
    return null;
};

const saveRTCState = debounce((key: string, value: WasmRTCState) => {
    localStorage.setItem(
        key,
        JSON.stringify({
            milliseconds: value.milliseconds,
            seconds: value.seconds,
            minutes: value.minutes,
            hours: value.hours,
            days: value.days,
            base_timestamp: value.base_timestamp,
            halted: value.halted,
            day_carry: value.day_carry,
        }),
    );
}, DEBOUNCE_DELAY);

const base64ToUint8Array = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

const loadRam = (key: string): Uint8Array | null => {
    const encodedCartridgeRam = localStorage.getItem(key);
    if (encodedCartridgeRam) {
        return base64ToUint8Array(encodedCartridgeRam);
    }
    return null;
};

const saveRam = debounce((key: string, value: Uint8Array) => {
    const binaryString = Array.from(value)
        .map(byte => String.fromCharCode(byte))
        .join("");
    const encodedCartridgeRam = btoa(binaryString);
    localStorage.setItem(key, encodedCartridgeRam);
}, DEBOUNCE_DELAY);

const registerCartridgeEffects = (): void => {
    window.currentTimeMillis = currentTimeMillis;
    window.loadRTCState = loadRTCState;
    window.saveRTCState = saveRTCState;
    window.loadRam = loadRam;
    window.saveRam = saveRam;
};

export default registerCartridgeEffects;
