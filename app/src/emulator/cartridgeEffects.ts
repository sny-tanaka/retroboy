// 出どころ: smparsons/retroboy frontends/web/src/cartridgeEffects.ts
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: lodash/debounce をやめ、書き込み待ちの値を 10 秒ごと（SAVE_INTERVAL）にまとめて書き出すようにした
//   （書き込み待ちが無ければ書かない）。flushPendingSaves で即時にも書き出せる。
//   読めない保存値は "<種類>-corrupt:<ROM の ID>" に退避する。
//   保存先は localStorage のままだが、キーをカートリッジのタイトルから ROM の ID（SHA-256）に替え、
//   ROM ごとにセーブが分かれるようにした（setActiveRomId）。pagehide / visibilitychange(hidden) で即時保存する。
//   保存の失敗は onSaveError で画面に知らせる。window への代入に型を付けた。
//   saveRam は呼ばれるたびに base64 にせず、その step の終わりに 1 回だけ RAM を写し、base64 にするのは
//   書き出すときにした（本家も lodash/debounce が呼び出しをまとめていたので重くなかった）。
//   詳しくは docs/upstream-notes.md。
//   GBA（mGBA。app/src/gba/gbaSession.ts）のゲーム内セーブも同じキー（sram:<ROM の ID>）・同じ書き出しの間隔で
//   保存する（readRamFor・scheduleRamWrite・setSaveSnapshotter）。
import { WasmRTCState } from "../core/retroboyCore";

// 書き込みごとではなく固定の間隔で書き出す。localStorage への書き込みと base64 への変換が、
// セーブのたびではなく最大でもこの間隔に 1 回になる
const SAVE_INTERVAL = 10000;

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

// 書き込み待ちの値（localStorage のキー → 文字列か、まだ base64 にしていないセーブ RAM の写し）。
// キーはコアから呼ばれた時点で決めるので、書き出す前に ROM を切り替えても前の ROM のキーに保存される
const pendingWrites = new Map<string, string | Uint8Array>();

const writeNow = (key: string): void => {
    const value = pendingWrites.get(key);
    if (value === undefined) return;
    try {
        localStorage.setItem(
            key,
            typeof value === "string" ? value : uint8ArrayToBase64(value),
        );
        pendingWrites.delete(key);
    } catch (err) {
        // 失敗した値は残し、次の書き出し（次の間隔か画面を離れるとき）で書き直す。
        // それまでに新しい書き込みがあれば、そちらに置き換わる
        console.error("ゲーム内セーブの保存に失敗しました:", err);
        notifySaveError(
            "ゲーム内セーブを端末に保存できませんでした。空き容量を確かめてください。",
        );
    }
};

// 書き出す前に呼ぶもの（GBA のゲーム内セーブを、変わっていれば書き込み待ちにする）
let saveSnapshotter: (() => void) | null = null;

export const setSaveSnapshotter = (snapshotter: (() => void) | null): void => {
    saveSnapshotter = snapshotter;
};

export const flushPendingSaves = (): void => {
    snapshotRam();
    saveSnapshotter?.();
    [...pendingWrites.keys()].forEach(writeNow);
};

// 書き込み待ちにするだけ。書き出すのは SAVE_INTERVAL ごとか flushPendingSaves のとき
const scheduleWrite = (key: string, value: string | Uint8Array): void => {
    if (writeBlockedKeys.has(key)) return;
    pendingWrites.set(key, value);
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
    // RTC の書き込み待ちは文字列だけ（Uint8Array になるのはセーブ RAM）
    const pending = pendingWrites.get(key);
    const item =
        typeof pending === "string" ? pending : localStorage.getItem(key);
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

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
    // 1 バイトずつ配列にすると遅いので、まとめて文字にする（引数の数の上限を超えないよう区切る）
    let binaryString = "";
    for (let i = 0; i < bytes.length; i += 0x2000) {
        binaryString += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
    }
    return btoa(binaryString);
};

/** ROM の ID のゲーム内セーブ（セーブ RAM）を読む（書き込み待ちがあればそれ）。無い・読めなければ null */
export const readRamFor = (romId: string): Uint8Array | null =>
    readRamAt(ramStorageKey(romId));

/** ROM の ID のゲーム内セーブを書き込み待ちにする（GBA。value は写してから渡す） */
export const scheduleRamWrite = (romId: string, value: Uint8Array): void =>
    scheduleWrite(ramStorageKey(romId), value);

const loadRam = (): Uint8Array | null => {
    const key = resolveKey(ramStorageKey);
    return key ? readRamAt(key) : null;
};

const readRamAt = (key: string): Uint8Array | null => {
    const pending = pendingWrites.get(key);
    if (pending instanceof Uint8Array) return pending.slice();
    const encodedCartridgeRam = pending ?? localStorage.getItem(key);
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

// コアは RAM に 1 バイト書くたびに saveRam を呼ぶ（ゲームは起動時やセーブ時に数 KB〜数十 KB をまとめて書くので、
// 1 回の step の中で数千〜数万回になる）。呼ばれたときは RAM の場所だけ覚え、step が終わったあと（microtask）に
// 1 回だけ写して書き込み待ちにする。base64 にするのは書き出すとき
let wasmMemory: WebAssembly.Memory | null = null;
let pendingRam: { key: string; byteOffset: number; length: number } | null =
    null;

// init() の戻り値の memory を渡す（saveRam の前に）
export const setWasmMemory = (memory: WebAssembly.Memory): void => {
    wasmMemory = memory;
};

const snapshotRam = (): void => {
    if (!pendingRam || !wasmMemory) return;
    const { key, byteOffset, length } = pendingRam;
    pendingRam = null;
    // コアから渡された Uint8Array は WASM のメモリの一部を指すだけで、メモリが広がると読めなくなる。
    // カートリッジの RAM の場所は ROM を読み込んでいる間は変わらないので、今のメモリから読み直して写す
    scheduleWrite(
        key,
        new Uint8Array(wasmMemory.buffer, byteOffset, length).slice(),
    );
};

const saveRam = (_title: string, value: Uint8Array): void => {
    const key = resolveKey(ramStorageKey);
    if (!key) return;
    if (pendingRam?.key !== key) {
        snapshotRam();
        queueMicrotask(snapshotRam);
    }
    pendingRam = { key, byteOffset: value.byteOffset, length: value.length };
};

const registerCartridgeEffects = (): void => {
    window.currentTimeMillis = currentTimeMillis;
    window.loadRTCState = loadRTCState;
    window.saveRTCState = saveRTCState;
    window.loadRam = loadRam;
    window.saveRam = saveRam;

    setInterval(flushPendingSaves, SAVE_INTERVAL);
    // iPhone でホームに戻す・アプリを閉じるときに、書き込み待ちのセーブを失わないよう即時に書き出す
    window.addEventListener("pagehide", flushPendingSaves);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flushPendingSaves();
        }
    });
};

export default registerCartridgeEffects;
