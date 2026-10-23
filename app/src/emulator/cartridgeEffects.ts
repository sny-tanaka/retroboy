// 出どころ: smparsons/retroboy frontends/web/src/cartridgeEffects.ts
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: lodash/debounce を、保留中の保存を即時に書き出せる（flushPendingSaves）小さな debounce に置き換え、
//   待ちの上限（MAX_WAIT）を付けた。読めない保存値は "<種類>-corrupt:<ROM の ID>" に退避する。
//   保存先は localStorage のままだが、キーをカートリッジのタイトルから ROM の ID（SHA-256）に替え、
//   ROM ごとにセーブが分かれるようにした（setActiveRomId）。pagehide / visibilitychange(hidden) で即時保存する。
//   保存の失敗は onSaveError で画面に知らせる。window への代入に型を付けた。詳しくは docs/upstream-notes.md。
import { WasmRTCState } from "../core/retroboyCore";

const DEBOUNCE_DELAY = 2000;
const MAX_WAIT = 10000;

// localStorage のキー。本家はタイトルそのもの（RTC は "<タイトル>-rtc"）をキーにしていた
const ramStorageKey = (romId: string): string => `sram:${romId}`;
const rtcStorageKey = (romId: string): string => `rtc:${romId}`;

// いま読み込んでいる ROM の ID。コアは loadRam/saveRam にタイトルを渡してくるが、それは使わない
let activeRomId: string | null = null;

// initializeEmulator の前に呼ぶ（その中で loadRam / loadRTCState が呼ばれる）
export const setActiveRomId = (romId: string | null): void => {
    activeRomId = romId;
};

const resolveKey = (
    toStorageKey: (romId: string) => string,
): string | null => {
    if (!activeRomId) {
        console.warn("ROM が選ばれていないので、セーブを読み書きしません");
        return null;
    }
    return toStorageKey(activeRomId);
};

type SaveErrorListener = (message: string) => void;
const saveErrorListeners = new Set<SaveErrorListener>();

// 保存に失敗したときに呼ばれる。戻り値で登録を解除する
export const onSaveError = (listener: SaveErrorListener): (() => void) => {
    saveErrorListeners.add(listener);
    return () => saveErrorListeners.delete(listener);
};

const notifySaveError = (message: string): void => {
    saveErrorListeners.forEach(listener => listener(message));
};

// 書き込み待ちの値（localStorage のキー → 文字列）。キーはコアから呼ばれた時点で決めるので、
// 書き出す前に ROM を切り替えても前の ROM のキーに保存される
const pendingWrites = new Map<string, string>();
// 本家と同じく、キーごとに debounce する（RTC の頻繁な保存でセーブ RAM の保存が遅れないように）
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
// キーごとの書き出しの期限（保留が始まってから MAX_WAIT 後）
const writeDeadlines = new Map<string, number>();

const writeNow = (key: string): void => {
    clearTimeout(writeTimers.get(key));
    writeTimers.delete(key);
    const value = pendingWrites.get(key);
    if (value === undefined) return;
    try {
        localStorage.setItem(key, value);
        pendingWrites.delete(key);
        writeDeadlines.delete(key);
    } catch (err) {
        // 失敗した値は残し、次の保存（次の書き込みか画面を離れるとき）で書き直す。
        // 毎フレーム書き直して失敗し続けないよう、次の期限は今から数え直す
        writeDeadlines.set(key, Date.now() + MAX_WAIT);
        console.error("ゲーム内セーブの保存に失敗しました:", err);
        notifySaveError(
            "ゲーム内セーブを端末に保存できませんでした。空き容量を確かめてください。",
        );
    }
};

export const flushPendingSaves = (): void => {
    [...pendingWrites.keys()].forEach(writeNow);
};

// lodash/debounce の trailing と同じく、最後の書き込みから DEBOUNCE_DELAY 後に書き出す。
// ただし MBC3 は RTC のラッチのたびに保存を呼び、毎フレームラッチするゲームではタイマーが延び続けるので、
// 保留が始まってから MAX_WAIT たったら必ず書く（lodash の maxWait にあたる）
const scheduleWrite = (key: string, value: string): void => {
    if (writeBlockedKeys.has(key)) return;
    pendingWrites.set(key, value);
    const now = Date.now();
    let deadline = writeDeadlines.get(key);
    if (deadline === undefined) {
        deadline = now + MAX_WAIT;
        writeDeadlines.set(key, deadline);
    }
    clearTimeout(writeTimers.get(key));
    writeTimers.set(
        key,
        setTimeout(
            () => writeNow(key),
            Math.max(0, Math.min(DEBOUNCE_DELAY, deadline - now)),
        ),
    );
};

// 退避できなかった壊れたセーブのキー。空のセーブで上書きして消さないよう、書き込みを止める
const writeBlockedKeys = new Set<string>();

// 読めなかった保存値を "<種類>-corrupt:<ROM の ID>" に退避する。読めないまま進めると、
// 空のセーブで始まり次の書き込みで元データを上書きしてしまうため
const quarantineCorrupt = (key: string, value: string): void => {
    const baseKey = key.replace(/^([a-z]+):/, "$1-corrupt:");
    const existing = localStorage.getItem(baseKey);
    const corruptKey =
        existing === null || existing === value
            ? baseKey
            : `${baseKey}:${Date.now()}`;
    try {
        localStorage.setItem(corruptKey, value);
        console.error(`読めなかったセーブを ${corruptKey} に退避しました`);
        notifySaveError(
            `保存したゲーム内セーブが壊れていて読めませんでした。元のデータは端末内（${corruptKey}）に残し、空のセーブで始めます。`,
        );
    } catch (err) {
        console.error("読めなかったセーブを退避できませんでした:", err);
        writeBlockedKeys.add(key);
        notifySaveError(
            "保存したゲーム内セーブが壊れていて読めず、退避もできませんでした。元のデータを消さないよう、このゲームのセーブは保存しません。",
        );
    }
};

const currentTimeMillis = () => Date.now();

const loadRTCState = (): WasmRTCState | null => {
    const key = resolveKey(rtcStorageKey);
    if (!key) return null;
    const item = pendingWrites.get(key) ?? localStorage.getItem(key);
    if (item) {
        try {
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
        } catch (err) {
            // 例外をコアに返すと WASM が止まるので、壊れた値は退避して無いものとして扱う
            console.error("保存した RTC の状態を読めませんでした:", err);
            quarantineCorrupt(key, item);
        }
    }
    return null;
};

const saveRTCState = (_title: string, value: WasmRTCState): void => {
    const key = resolveKey(rtcStorageKey);
    if (!key) return;
    scheduleWrite(
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
};

const base64ToUint8Array = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

const loadRam = (): Uint8Array | null => {
    const key = resolveKey(ramStorageKey);
    if (!key) return null;
    const encodedCartridgeRam = pendingWrites.get(key) ?? localStorage.getItem(key);
    if (encodedCartridgeRam) {
        try {
            return base64ToUint8Array(encodedCartridgeRam);
        } catch (err) {
            console.error("保存したゲーム内セーブを読めませんでした:", err);
            quarantineCorrupt(key, encodedCartridgeRam);
        }
    }
    return null;
};

const saveRam = (_title: string, value: Uint8Array): void => {
    const key = resolveKey(ramStorageKey);
    if (!key) return;
    const binaryString = Array.from(value)
        .map(byte => String.fromCharCode(byte))
        .join("");
    scheduleWrite(key, btoa(binaryString));
};

const registerCartridgeEffects = (): void => {
    window.currentTimeMillis = currentTimeMillis;
    window.loadRTCState = loadRTCState;
    window.saveRTCState = saveRTCState;
    window.loadRam = loadRam;
    window.saveRam = saveRam;

    // iPhone でホームに戻す・アプリを閉じるときに、2 秒待ちのセーブを失わないよう即時に書き出す
    window.addEventListener("pagehide", flushPendingSaves);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flushPendingSaves();
        }
    });
};

export default registerCartridgeEffects;
