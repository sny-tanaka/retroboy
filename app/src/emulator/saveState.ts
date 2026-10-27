// 出どころ: smparsons/retroboy frontends/web/src/interface.tsx の saveState /
//   handleLoadStateChange / downloadFile と components/bufferFileUpload.tsx の buildFileBufferObject
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: React コンポーネントから切り出し、エラーは戻り値で返すようにした。
//   blob URL の解放を 1 秒遅らせた（iOS Safari 対策）。6 バイト未満のファイルはコアに渡さない（panic するため）。
//   .rbs ファイルのダウンロード／読み込みに加え、端末内の枠（storage/romDb.ts の saveStates）に
//   保存するためのバイト列の取り出し（captureSaveState）と、バイト列からの適用（applySaveStateBytes）を足した。
//   GBA のゲームが動いている間は mGBA（gba/gbaSession.ts）のセーブステートを使う（ファイルは <名前>.ss1）。
import { applySaveState, encodeSaveState } from "../core/retroboyCore";
import { getGbaCore } from "../gba/gbaSession";

const REVOKE_DELAY = 1000;
const GBA_STATE_ERROR = "このゲームのセーブステートではないようです。";
// 本家 smparsons/retroboy の src/emulator/save_state.rs の "HEADER" の長さ
const MIN_SAVE_STATE_LENGTH = 6;

export interface FileBufferObject {
    filename: string;
    data: Uint8Array;
}

export const buildFileBufferObject = async (
    file: File,
): Promise<FileBufferObject> => ({
    filename: file.name,
    data: new Uint8Array(await file.arrayBuffer()),
});

const downloadFile = (
    content: BlobPart,
    filename: string,
    mimeType: string,
): void => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    // iOS Safari はダウンロードを始める前に blob URL を解放すると失敗するので、少し遅らせる
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY);
};

// 現在の状態を <ROM ファイル名>.rbs としてダウンロードする。失敗時はエラー文を返す。
export const downloadSaveState = (romFilename: string): string | null => {
    const gba = getGbaCore();
    if (gba) {
        const state = gba.saveState();
        if (!state) return "セーブステートを作れませんでした。";
        downloadFile(
            state as Uint8Array<ArrayBuffer>,
            `${romFilename.split(".")[0]}.ss1`,
            "application/octet-stream",
        );
        return null;
    }
    const result = encodeSaveState();
    if (result.error) {
        return result.error;
    }
    if (result.saveState) {
        const saveStateName = romFilename.split(".")[0];
        downloadFile(
            result.saveState as Uint8Array<ArrayBuffer>,
            `${saveStateName}.rbs`,
            "application/octet-stream",
        );
    }
    return null;
};

// いまの状態をバイト列にする（端末内の枠に保存する用）。呼んだ瞬間の状態を、コアから切り離したコピーで返す
export const captureSaveState = ():
    | { data: ArrayBuffer }
    | { error: string } => {
    const gba = getGbaCore();
    if (gba) {
        const state = gba.saveState();
        return state ? { data: state.buffer as ArrayBuffer } : { error: "" };
    }
    const result = encodeSaveState();
    if (result.error || !result.saveState) {
        return { error: result.error ?? "" };
    }
    return { data: result.saveState.slice().buffer };
};

// バイト列のセーブステートを適用する。失敗時はエラー文を返す。別のゲームのセーブステートならコア側でエラーになる
export const applySaveStateBytes = (data: Uint8Array): string | null => {
    const gba = getGbaCore();
    if (gba) return gba.loadState(data) ? null : GBA_STATE_ERROR;
    // コアは長さを確かめる前に先頭 6 バイト（"HEADER"）を切り出すので、短いと panic して WASM が使えなくなる
    if (data.length < MIN_SAVE_STATE_LENGTH) {
        return "セーブステートのデータではないようです。";
    }
    return applySaveState(data) ?? null;
};

// .rbs ファイルを読み込んで適用する。別のゲームのセーブステートならコア側でエラーになる。
export const loadSaveStateFile = async (file: File): Promise<string | null> => {
    try {
        const bufferObject = await buildFileBufferObject(file);
        const gba = getGbaCore();
        if (gba) {
            return gba.loadState(bufferObject.data) ? null : GBA_STATE_ERROR;
        }
        // コアは長さを確かめる前に先頭 6 バイト（"HEADER"）を切り出すので、短いと panic して WASM が使えなくなる
        if (bufferObject.data.length < MIN_SAVE_STATE_LENGTH) {
            return "セーブステートのファイルではないようです。";
        }
        return applySaveState(bufferObject.data) ?? null;
    } catch (err) {
        console.error("Error loading save state:", err);
        return "セーブステートの読み込み中にエラーが発生しました。";
    }
};
