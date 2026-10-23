// 出どころ: smparsons/retroboy frontends/web/src/interface.tsx の saveState /
//   handleLoadStateChange / downloadFile と components/bufferFileUpload.tsx の buildFileBufferObject
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: React コンポーネントから切り出し、エラーは戻り値で返すようにした。
//   blob URL の解放を 1 秒遅らせた（iOS Safari 対策）。6 バイト未満のファイルはコアに渡さない（panic するため）。
//   セーブステートは本家と同じく .rbs ファイルとしてダウンロード／ファイルから読み込む（端末内に保存はしない）。
import { applySaveState, encodeSaveState } from "../core/retroboyCore";

const REVOKE_DELAY = 1000;
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

// .rbs ファイルを読み込んで適用する。別のゲームのセーブステートならコア側でエラーになる。
export const loadSaveStateFile = async (file: File): Promise<string | null> => {
    try {
        const bufferObject = await buildFileBufferObject(file);
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
