// いま動いている GBA のゲーム（1 本だけ）。始める・止める・ボタン・ゲーム内セーブ。
// 進めるのは useGbaLoop.ts（音の予約の時刻で 1 フレームずつ進める）。
//
// ゲーム内セーブ: mGBA はゲームが書いたセーブを WASM のメモリの中の領域に直に置く。Game Boy と同じ
// emulator/cartridgeEffects.ts の書き出し（10 秒ごと・画面を離れるとき）の直前に中身を読み、前に保存したものと
// 違えば書き込み待ちにする（キーも Game Boy と同じ sram:<ROM の ID>）。
import {
    flushPendingSaves,
    readRamFor,
    scheduleRamWrite,
    setSaveSnapshotter,
} from "../emulator/cartridgeEffects";
import { GBA_KEY_BITS, GbaCore, loadMgba } from "./gbaCore";

let core: GbaCore | null = null;
let romId: string | null = null;
let keys = 0;
// 最後に書き込み待ちにした（または読み込んだ）ゲーム内セーブ。同じなら書かない
let lastSave: Uint8Array | null = null;

export const getGbaCore = (): GbaCore | null => core;

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

const snapshotSave = (): void => {
    if (!core || !romId) return;
    const data = core.saveData();
    if (!data || (lastSave && sameBytes(data, lastSave))) return;
    scheduleRamWrite(romId, data);
    lastSave = data;
};

/**
 * GBA の ROM を始める（前のゲームは止める）。mGBA をまだ読んでいなければ読み込む。
 * 読み込みを待っている間にほかの読み込みが始まった（stillWanted が false）なら、何もせず "cancelled" を返す
 */
export const startGba = async (
    id: string,
    rom: ArrayBuffer,
    sampleRate: number,
    stillWanted: () => boolean,
): Promise<{ title: string } | { error: string } | "cancelled"> => {
    stopGba();
    let module;
    try {
        module = await loadMgba();
    } catch (err) {
        console.error("mGBA の読み込みに失敗しました:", err);
        return { error: "GBA のエミュレーターを読み込めませんでした。" };
    }
    if (!stillWanted()) return "cancelled";
    const save = readRamFor(id);
    const created = GbaCore.create(module, rom, save, sampleRate);
    if ("error" in created) return created;
    core = created;
    romId = id;
    keys = 0;
    lastSave = save;
    setSaveSnapshotter(snapshotSave);
    return { title: created.title() };
};

/** 止める。書き込み待ちのゲーム内セーブを先に書き出す */
export const stopGba = (): void => {
    if (!core) return;
    flushPendingSaves();
    setSaveSnapshotter(null);
    core.unload();
    core = null;
    romId = null;
    keys = 0;
    lastSave = null;
};

export const pressGbaKey = (key: string): void => {
    keys |= GBA_KEY_BITS[key] ?? 0;
    core?.setKeys(keys);
};

export const releaseGbaKey = (key: string): void => {
    keys &= ~(GBA_KEY_BITS[key] ?? 0);
    core?.setKeys(keys);
};

export const releaseAllGbaKeys = (): void => {
    keys = 0;
    core?.setKeys(keys);
};
