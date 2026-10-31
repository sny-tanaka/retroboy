// 出どころ: smparsons/retroboy frontends/web/src/interface.tsx の saveState /
//   handleLoadStateChange / downloadFile と components/bufferFileUpload.tsx の buildFileBufferObject
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: React コンポーネントから切り出し、エラーは戻り値で返すようにした。
//   blob URL の解放を 1 秒遅らせた（iOS Safari 対策）。6 バイト未満のファイルはコアに渡さない（panic するため）。
//   .rbs ファイルのダウンロード／読み込みに加え、端末内の枠（storage/romDb.ts の saveStates）に
//   保存するためのバイト列の取り出し（captureSaveState）と、バイト列からの適用（applySaveStateBytes）を足した。
//   GBA のゲームが動いている間は mGBA（gba/gbaSession.ts）のセーブステートを使う（ファイルは <名前>.ss1）。
//   .ss1 にはゲーム内セーブも入れ（別の端末へ引っ越せるように）、読み込むときに置き換えるかを選べるようにした。
import { applySaveState, encodeSaveState } from "../core/retroboyCore";
import { flushPendingSaves } from "./cartridgeEffects";
import { getGbaCore } from "../gba/gbaSession";

const REVOKE_DELAY = 1000;
const GBA_STATE_ERROR = "このゲームのセーブステートではないようです。";
const GBA_SAVE_ERROR = "ゲーム内セーブは置き換えられませんでした。";
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
// GBA は <ROM ファイル名>.ss1 で、ゲーム内セーブも含める（Game Boy の .rbs はもともとカートリッジの RAM を含む）
export const downloadSaveState = (romFilename: string): string | null => {
    const gba = getGbaCore();
    if (gba) {
        const state = gba.saveState(true);
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

// いまの状態をバイト列にする（端末内の枠に保存する用）。呼んだ瞬間の状態を、コアから切り離したコピーで返す。
// GBA はゲーム内セーブを含めない（枠からロードしてもゲーム内セーブが巻き戻らないように）
export const captureSaveState = ():
    | { data: ArrayBuffer }
    | { error: string } => {
    const gba = getGbaCore();
    if (gba) {
        const state = gba.saveState(false);
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
    if (gba) return gba.loadState(data, false) === "error" ? GBA_STATE_ERROR : null;
    // コアは長さを確かめる前に先頭 6 バイト（"HEADER"）を切り出すので、短いと panic して WASM が使えなくなる
    if (data.length < MIN_SAVE_STATE_LENGTH) {
        return "セーブステートのデータではないようです。";
    }
    return applySaveState(data) ?? null;
};

// ファイルを読んだ結果。GBA のゲーム内セーブを含むファイルなら、適用せずに置き換えるかを聞く（askSave）
export type StateFileResult =
    | { readonly kind: "done"; readonly error: string | null }
    | { readonly kind: "askSave"; readonly data: Uint8Array };

// .rbs / .ss1 ファイルを読み込んで適用する。別のゲームのセーブステートならコア側でエラーになる。
// ゲーム内セーブを含む .ss1 は適用せずに askSave を返す（答えを聞いてから applyGbaStateFile で適用する）
export const loadSaveStateFile = async (
    file: File,
): Promise<StateFileResult> => {
    const done = (error: string | null): StateFileResult => ({
        kind: "done",
        error,
    });
    try {
        const bufferObject = await buildFileBufferObject(file);
        const gba = getGbaCore();
        if (gba) {
            if (gba.stateHasSave(bufferObject.data)) {
                return { kind: "askSave", data: bufferObject.data };
            }
            return done(applyGbaStateFile(bufferObject.data, false));
        }
        // コアは長さを確かめる前に先頭 6 バイト（"HEADER"）を切り出すので、短いと panic して WASM が使えなくなる
        if (bufferObject.data.length < MIN_SAVE_STATE_LENGTH) {
            return done("セーブステートのファイルではないようです。");
        }
        return done(applySaveState(bufferObject.data) ?? null);
    } catch (err) {
        console.error("Error loading save state:", err);
        return done("セーブステートの読み込み中にエラーが発生しました。");
    }
};

// GBA の .ss1 を適用する。withSave なら、含まれているゲーム内セーブでいまのものを置き換え、端末にもすぐ書く
// （閉じても残るように）。失敗時はエラー文を返す
export const applyGbaStateFile = (
    data: Uint8Array,
    withSave: boolean,
): string | null => {
    const gba = getGbaCore();
    if (!gba) return GBA_STATE_ERROR;
    const result = gba.loadState(data, withSave);
    if (result === "error") return GBA_STATE_ERROR;
    if (withSave) flushPendingSaves();
    return result === "saveError" ? GBA_SAVE_ERROR : null;
};
