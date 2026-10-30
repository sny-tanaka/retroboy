// 内蔵ソフトのゲーム内セーブ（localStorage `sram:<ROM の ID>`・`rtc:<ROM の ID>`）の引き継ぎと、
// 古い版のものの掃除。決まりは docs/builtin-games.md の「版が上がったときのセーブ」「古い版のセーブの掃除」。
// 目録（virtual:builtin-games）や localStorage に直に触れず、引数で受け取る（node --test で試せるように）。
//
// アプリには、新しい版のゲームが前の版のセーブを正しく取り込めたかは分からない。そこで、
// - 自動（起動時の掃除）では、いまの版と 1 つ前の版（と saveFormat ごとの最新の版など）を残し、それより古い版だけ消す
// - 1 つ前の版は、引き継げたと確かめた利用者が、メニューの「古い版のセーブを消す」で消す
import type { BuiltinGame } from "./builtinGame";

// cartridgeEffects.ts のキーと同じ
const SAVE_KINDS = ["sram", "rtc"] as const;
const SAVE_KEY = /^(?:sram|rtc):(.+)$/;

const PLAYED_PREFIX = "builtinSave:";

// 前に遊んだ版。localStorage `builtinSave:<id>` に { sha256, saveFormat } を持つ
interface PlayedVersion {
    readonly sha256: string;
    readonly saveFormat: number;
}

const parsePlayed = (text: string | null): PlayedVersion | null => {
    try {
        const value: unknown = JSON.parse(text ?? "null");
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

// 中身のあるゲーム内セーブか
const hasSave = (storage: Storage, key: string): boolean =>
    (storage.getItem(key) ?? "") !== "";

/**
 * 内蔵ソフトを始める前に呼ぶ。ここでは何も消さない。前に遊んだ版と中身が違い、saveFormat が同じなら、
 * 前の版のゲーム内セーブをいまの版の ID に写す（いまの版にまだ無いときだけ）。
 * 前の版に中身があるのに、いまの版のキーが空（空文字など）なら、記録を進めない（前の版を前に遊んだ版のまま守る）。
 * 失敗したら例外を投げる（記録は書き換えないので、次に開いたときにやり直す）
 */
export const carryOverSaveIn = (storage: Storage, game: BuiltinGame): void => {
    const played = parsePlayed(storage.getItem(PLAYED_PREFIX + game.id));
    if (played && played.sha256 !== game.sha256) {
        if (played.saveFormat === game.saveFormat) {
            for (const kind of SAVE_KINDS) {
                const from = storage.getItem(`${kind}:${played.sha256}`);
                const to = `${kind}:${game.sha256}`;
                if (from !== null && storage.getItem(to) === null) {
                    storage.setItem(to, from);
                }
            }
            if (
                SAVE_KINDS.some(
                    kind =>
                        hasSave(storage, `${kind}:${played.sha256}`) &&
                        !hasSave(storage, `${kind}:${game.sha256}`),
                )
            ) {
                return;
            }
        }
    }
    storage.setItem(
        PLAYED_PREFIX + game.id,
        JSON.stringify({
            sha256: game.sha256,
            saveFormat: game.saveFormat,
        } satisfies PlayedVersion),
    );
};

// 端末にゲーム内セーブがある、内蔵ソフトの過去の版（新しい順。利用者の ROM と同じ ID は除く）
const savedPastVersions = (
    storage: Storage,
    game: BuiltinGame,
    romIds: ReadonlySet<string>,
): BuiltinGame["pastVersions"] => {
    const saved = new Set<string>();
    for (let i = 0; i < storage.length; i++) {
        const id = storage.key(i)?.match(SAVE_KEY)?.[1];
        if (id !== undefined) saved.add(id);
    }
    return game.pastVersions.filter(
        ({ sha256 }) =>
            sha256 !== game.sha256 && saved.has(sha256) && !romIds.has(sha256),
    );
};

// 前に遊んだ版の記録。読めないものがあれば null（何を守ればよいか分からない）
const playedVersions = (storage: Storage): Map<string, string> | null => {
    const played = new Map<string, string>();
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(PLAYED_PREFIX)) continue;
        const record = parsePlayed(storage.getItem(key));
        if (!record) return null;
        played.set(key.slice(PLAYED_PREFIX.length), record.sha256);
    }
    return played;
};

// ある版の sram:・rtc: を消す（書き込み待ちがあれば、その版は消さない）。消したキーの数
const removeVersion = (
    storage: Storage,
    id: string,
    isPending: (key: string) => boolean,
): number => {
    if (SAVE_KINDS.some(kind => isPending(`${kind}:${id}`))) return 0;
    let removed = 0;
    for (const kind of SAVE_KINDS) {
        const key = `${kind}:${id}`;
        if (storage.getItem(key) !== null) {
            storage.removeItem(key);
            removed++;
        }
    }
    return removed;
};

/**
 * 起動時の掃除で消す版（内蔵ソフトの過去の版のうち、端末にセーブがあり、次のどれにも当たらないもの）:
 * いまの版より新しい版（版を戻して公開したとき）・1 つ前の版（いまの版より古い中で、いちばん新しい版）・
 * saveFormat ごとに、いまの版より古い中でいちばん新しい版・saveFormat の分からない版・前に遊んだ版の記録にある版
 */
export const autoStaleVersions = (
    storage: Storage,
    game: BuiltinGame,
    romIds: ReadonlySet<string>,
    played: ReadonlySet<string>,
): string[] => {
    const older = savedPastVersions(storage, game, romIds).filter(
        version => !version.newer,
    );
    const keep = new Set<string>(played);
    if (older[0]) keep.add(older[0].sha256);
    const formats = new Set<number>();
    for (const { sha256, saveFormat } of older) {
        if (saveFormat === undefined) {
            keep.add(sha256);
        } else if (!formats.has(saveFormat)) {
            formats.add(saveFormat);
            keep.add(sha256);
        }
    }
    return older
        .map(({ sha256 }) => sha256)
        .filter(sha256 => !keep.has(sha256));
};

/**
 * 起動時の掃除。内蔵ソフトの過去の版のゲーム内セーブのうち、autoStaleVersions のものを消す。
 * 一覧に無い ID・利用者の ROM・書き込み待ちのあるキー・`-corrupt:` の退避・ほかのキーには触れない。
 * 読めない `builtinSave:` があれば何も消さない。消したキーの数を返す
 */
export const pruneGameSaves = (
    storage: Storage,
    games: readonly BuiltinGame[],
    romIds: readonly string[],
    isPending: (key: string) => boolean,
): number => {
    const played = playedVersions(storage);
    if (!played) return 0;
    const roms = new Set(romIds);
    const keep = new Set(played.values());
    let removed = 0;
    for (const game of games) {
        for (const id of autoStaleVersions(storage, game, roms, keep)) {
            removed += removeVersion(storage, id, isPending);
        }
    }
    return removed;
};

/**
 * メニューの「古い版のセーブを消す」で消せる版（内蔵ソフトごと。無いソフトは入れない）。
 * いまの版以外の過去の版のうち、端末にセーブがあるもの。利用者の ROM と同じ ID は入れない。
 * まだ新しい版を開いていない（前に遊んだ版が、いまの版でない）ときの前に遊んだ版は、引き継ぐ前なので入れない
 */
export const manualStaleVersions = (
    storage: Storage,
    games: readonly BuiltinGame[],
    romIds: readonly string[],
): { game: BuiltinGame; ids: string[] }[] => {
    const played = playedVersions(storage);
    if (!played) return [];
    const roms = new Set(romIds);
    return games.flatMap(game => {
        const ids = savedPastVersions(storage, game, roms)
            .map(({ sha256 }) => sha256)
            .filter(sha256 => played.get(game.id) !== sha256);
        return ids.length > 0 ? [{ game, ids }] : [];
    });
};

/** メニューの「古い版のセーブを消す」の「はい」。manualStaleVersions の版を消し、消したキーの数を返す */
export const removeManualStaleSaves = (
    storage: Storage,
    games: readonly BuiltinGame[],
    romIds: readonly string[],
    isPending: (key: string) => boolean,
): number =>
    manualStaleVersions(storage, games, romIds)
        .flatMap(({ ids }) => ids)
        .reduce((sum, id) => sum + removeVersion(storage, id, isPending), 0);

/** 消すセーブステートの枠の ID。目録の過去の版にあり、利用者の ROM（romIds）でないもの（文字列でないキーには触れない） */
export const staleSaveStateIds = (
    saveStateKeys: readonly IDBValidKey[],
    games: readonly BuiltinGame[],
    romIds: readonly string[],
): string[] => {
    const current = new Set(games.map(game => game.sha256));
    const roms = new Set(romIds);
    const past = new Set(
        games
            .flatMap(game => game.pastVersions.map(({ sha256 }) => sha256))
            .filter(id => !current.has(id) && !roms.has(id)),
    );
    return saveStateKeys.filter(
        (key): key is string => typeof key === "string" && past.has(key),
    );
};
