// 内蔵ソフト（リポジトリの games/ にある自作ゲーム）。決まりは docs/builtin-games.md。
//
// - 目録はビルドのときに JS に入る（virtual:builtin-games）。ROM は dist/builtin/ にあり、選んだときに毎回取る。
//   Service Worker が事前キャッシュしているので、オフラインでもキャッシュから出る。IndexedDB には入れない
//   （アプリの版と ROM がいつも揃い、古い版が端末に溜まらない。利用者の ROM の一覧にも混ざらない）。
// - ROM の ID は利用者の ROM と同じく中身の SHA-256 なので、ゲーム内セーブ・セーブステートは版ごとに分かれる。
//   版が上がって中身が変わったら、ゲーム内セーブだけを前の版から写す（saveFormat が同じとき。carryOverSave）。
// - 前回の ROM（lastRomId）には SHA-256 ではなく "builtin:<id>" を覚え、版が上がっても新しい版を開く。
import builtinGames from "virtual:builtin-games";

import type { BuiltinGame } from "./builtinGame";
import { type RomRecord, RomStorageError } from "./romDb";
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

// 前に遊んだ版。localStorage `builtinSave:<id>` に { sha256, saveFormat } を持つ
interface PlayedVersion {
    readonly sha256: string;
    readonly saveFormat: number;
}

const playedKey = (game: BuiltinGame): string => `builtinSave:${game.id}`;

const readPlayed = (game: BuiltinGame): PlayedVersion | null => {
    try {
        const value: unknown = JSON.parse(
            localStorage.getItem(playedKey(game)) ?? "null",
        );
        if (
            typeof value === "object" &&
            value !== null &&
            "sha256" in value &&
            typeof value.sha256 === "string" &&
            "saveFormat" in value &&
            typeof value.saveFormat === "number"
        ) {
            return { sha256: value.sha256, saveFormat: value.saveFormat };
        }
    } catch {
        // 読めなければ、前の版は無かったことにする
    }
    return null;
};

// cartridgeEffects.ts のキーと同じ
const SAVE_KINDS = ["sram", "rtc"] as const;

/**
 * 内蔵ソフトを始める前（initializeEmulator がゲーム内セーブを読む前、書き込み待ちを書き出したあと）に呼ぶ。
 * 前に遊んだ版と中身が違い、saveFormat が同じなら、前の版のゲーム内セーブ（セーブ RAM・RTC）を
 * いまの版の ID に写す（いまの版にまだゲーム内セーブが無いときだけ。前の版のものは消さずに残す）。
 * セーブステートは ROM が違うと戻せないので写さない（いまの版では「セーブがありません」から始まる）。
 */
export const carryOverSave = (game: BuiltinGame): void => {
    try {
        const played = readPlayed(game);
        if (
            played &&
            played.sha256 !== game.sha256 &&
            played.saveFormat === game.saveFormat
        ) {
            for (const kind of SAVE_KINDS) {
                const from = localStorage.getItem(`${kind}:${played.sha256}`);
                const to = `${kind}:${game.sha256}`;
                if (from !== null && localStorage.getItem(to) === null) {
                    localStorage.setItem(to, from);
                }
            }
        }
        localStorage.setItem(
            playedKey(game),
            JSON.stringify({
                sha256: game.sha256,
                saveFormat: game.saveFormat,
            } satisfies PlayedVersion),
        );
    } catch (err) {
        // 写せなくても遊ぶのは続けられる（いまの版は空のゲーム内セーブで始まる。前の版のものは残っている）
        console.error("内蔵ソフトのゲーム内セーブを引き継げませんでした:", err);
    }
};
