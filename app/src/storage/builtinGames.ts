// 内蔵ソフト（リポジトリの games/ にある自作ゲーム）。決まりは docs/builtin-games.md。
//
// - 目録はビルドのときに JS に入る（virtual:builtin-games）。ROM は dist/builtin/ にあり、選んだときに毎回取る。
//   Service Worker が事前キャッシュしているので、オフラインでもキャッシュから出る。IndexedDB には入れない
//   （アプリの版と ROM がいつも揃い、古い版が端末に溜まらない。利用者の ROM の一覧にも混ざらない）。
// - ROM の ID は利用者の ROM と同じく中身の SHA-256 なので、ゲーム内セーブ・セーブステートは版ごとに分かれる。
//   版が上がって中身が変わったら、ゲーム内セーブだけを前の版から写す（saveFormat が同じとき。carryOverSave）。
//   古い版は端末に溜めない。セーブステートは版が変わったら消し、ゲーム内セーブは自動ではいまの版と 1 つ前の版などを
//   残して消す（cleanUpOldSaves）。1 つ前の版は、利用者がメニューの「古い版のセーブを消す」で消す。
// - 前回の ROM（lastRomId）には SHA-256 ではなく "builtin:<id>" を覚え、版が上がっても新しい版を開く。
import builtinGames from "virtual:builtin-games";

import { hasPendingWrite } from "../emulator/cartridgeEffects";
import type { BuiltinGame } from "./builtinGame";
import {
    carryOverSaveIn,
    manualStaleVersions,
    pruneGameSaves,
    removeManualStaleSaves,
} from "./builtinSaves";
import {
    listRoms,
    pruneSaveStates,
    type RomRecord,
    RomStorageError,
} from "./romDb";
import { computeRomId } from "./romId";

export type { BuiltinGame } from "./builtinGame";

export const BUILTIN_GAMES: readonly BuiltinGame[] = builtinGames;

const LAST_ROM_PREFIX = "builtin:";

export const findBuiltinBySha = (sha256: string): BuiltinGame | undefined =>
    BUILTIN_GAMES.find(game => game.sha256 === sha256);

/** lastRomId に覚える値 */
export const builtinLastRomId = (game: BuiltinGame): string =>
    `${LAST_ROM_PREFIX}${game.id}`;

/**
 * lastRomId が内蔵ソフトを指していれば、その ROM の ID（いまの版の SHA-256）。
 * 内蔵ソフトだったが無くなっていれば null、内蔵ソフトでなければ undefined
 */
export const resolveBuiltinLastRomId = (
    lastRomId: string,
): string | null | undefined => {
    if (!lastRomId.startsWith(LAST_ROM_PREFIX)) return undefined;
    const id = lastRomId.slice(LAST_ROM_PREFIX.length);
    return BUILTIN_GAMES.find(game => game.id === id)?.sha256 ?? null;
};

/** 内蔵ソフトの ROM を取る（オフラインなら Service Worker のキャッシュから）。中身が目録と違えば失敗にする */
export const loadBuiltinRom = async (game: BuiltinGame): Promise<RomRecord> => {
    const failed = `内蔵ソフト「${game.name}」を読み込めませんでした。通信できる所で開き直してください。`;
    let data: ArrayBuffer;
    try {
        const response = await fetch(`${import.meta.env.BASE_URL}${game.file}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.arrayBuffer();
    } catch (err) {
        console.error("内蔵ソフトの ROM を取れませんでした:", err);
        throw new RomStorageError(failed, { cause: err });
    }
    if (
        data.byteLength !== game.size ||
        (await computeRomId(data)) !== game.sha256
    ) {
        throw new RomStorageError(failed);
    }
    return { id: game.sha256, name: game.name, data, createdAt: 0 };
};

/**
 * 内蔵ソフトを始める前（initializeEmulator がゲーム内セーブを読む前、書き込み待ちを書き出したあと）に呼ぶ。
 * 前に遊んだ版と中身が違い、saveFormat が同じなら、前の版のゲーム内セーブ（セーブ RAM・RTC）を
 * いまの版の ID に写す（いまの版にまだゲーム内セーブが無いときだけ）。ここでは何も消さない（carryOverSaveIn）。
 * セーブステートは ROM が違うと戻せないので写さない（いまの版では「セーブがありません」から始まる）。
 */
export const carryOverSave = (game: BuiltinGame): void => {
    try {
        carryOverSaveIn(localStorage, game);
    } catch (err) {
        // 写せなくても遊ぶのは続けられる（いまの版は空のゲーム内セーブで始まる。前の版のものは残っている）
        console.error("内蔵ソフトのゲーム内セーブを引き継げませんでした:", err);
    }
};

/**
 * 起動時に 1 回呼ぶ。内蔵ソフトの過去の版（目録の pastVersions）のセーブステートの枠と、いまの版・1 つ前の版などを
 * 残した古い版のゲーム内セーブ（builtinSaves.ts の pruneGameSaves）を消す。利用者の ROM（roms にある ID）のものは
 * 消さない。roms が読めなければ何も消さない
 */
export const cleanUpOldSaves = async (): Promise<void> => {
    let pruned: { romIds: string[]; deleted: number };
    try {
        pruned = await pruneSaveStates(BUILTIN_GAMES);
    } catch (err) {
        console.warn("古い版のセーブを掃除しませんでした:", err);
        return;
    }
    let gameSaves = 0;
    try {
        gameSaves = pruneGameSaves(
            localStorage,
            BUILTIN_GAMES,
            pruned.romIds,
            hasPendingWrite,
        );
    } catch (err) {
        console.warn("古い版のゲーム内セーブを掃除できませんでした:", err);
    }
    if (pruned.deleted > 0 || gameSaves > 0) {
        console.info(
            `古い版のセーブを消しました（セーブステート ${pruned.deleted} 件、ゲーム内セーブ ${gameSaves} 件）`,
        );
    }
};

/** メニューの「古い版のセーブを消す」で消せる古い版（内蔵ソフトの名前と版の数）。romIds は利用者の ROM の ID */
export const listOldBuiltinSaves = (
    romIds: readonly string[],
): { name: string; versions: number }[] => {
    try {
        return manualStaleVersions(localStorage, BUILTIN_GAMES, romIds).map(
            ({ game, ids }) => ({ name: game.name, versions: ids.length }),
        );
    } catch {
        return [];
    }
};

/**
 * メニューの「古い版のセーブを消す」の「はい」。いまの版以外の内蔵ソフトの過去の版のゲーム内セーブを消す。
 * 利用者の ROM は消す直前に roms から読み直す（読めなければ何も消さず、RomStorageError）
 */
export const deleteOldBuiltinSaves = async (): Promise<void> => {
    const romIds = (await listRoms()).map(rom => rom.id);
    const removed = removeManualStaleSaves(
        localStorage,
        BUILTIN_GAMES,
        romIds,
        hasPendingWrite,
    );
    console.info(`古い版のゲーム内セーブを消しました（${removed} 件）`);
};

