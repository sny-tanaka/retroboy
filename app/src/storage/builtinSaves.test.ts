/// <reference types="node" />
// builtinSaves.ts の試験（npm test。node --test で、localStorage の代わりに手元の Storage を渡す）
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BuiltinGame } from "./builtinGame.ts";
import {
    carryOverSaveIn,
    manualStaleVersions,
    pruneGameSaves,
    removeManualStaleSaves,
    staleSaveStateIds,
} from "./builtinSaves.ts";

class MemoryStorage implements Storage {
    private readonly items = new Map<string, string>();
    constructor(entries: Record<string, string> = {}) {
        Object.entries(entries).forEach(([key, value]) =>
            this.items.set(key, value),
        );
    }
    get length(): number {
        return this.items.size;
    }
    clear(): void {
        this.items.clear();
    }
    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }
    key(index: number): string | null {
        return [...this.items.keys()][index] ?? null;
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
    setItem(key: string, value: string): void {
        this.items.set(key, value);
    }
    keys(): string[] {
        return [...this.items.keys()].sort();
    }
}

// setItem で指定のキーに書くと失敗する（容量が足りないときの代わり）
// （node の型の取り除きは引数のプロパティを扱えないので、フィールドに書く）
class FullStorage extends MemoryStorage {
    private readonly fullKey: string;
    constructor(entries: Record<string, string>, fullKey: string) {
        super(entries);
        this.fullKey = fullKey;
    }
    override setItem(key: string, value: string): void {
        if (key === this.fullKey) throw new Error("QuotaExceededError");
        super.setItem(key, value);
    }
}

// テイマーズライフ GBA 版の版（新しい順）。v1・v0 は saveFormat 1、vx は形式が分からない
const HISTORY = [
    { sha256: "v5", saveFormat: 2 },
    { sha256: "v4", saveFormat: 2 },
    { sha256: "v3", saveFormat: 2 },
    { sha256: "v2", saveFormat: 2 },
    { sha256: "v1", saveFormat: 1 },
    { sha256: "v0", saveFormat: 1 },
    { sha256: "vx" },
];
// いまの版を sha256 にした目録（plugins/builtinGames.ts と同じく、いまの版より新しい版に newer を付ける）
const tamers = (sha256: string, saveFormat = 2): BuiltinGame => {
    const at = HISTORY.findIndex(version => version.sha256 === sha256);
    return {
        id: "tamers-life-gba",
        name: "テイマーズライフ",
        description: "",
        system: "gba",
        sha256,
        size: 0,
        file: "",
        saveFormat,
        pastVersions: HISTORY.flatMap((version, index) =>
            version.sha256 === sha256
                ? []
                : [index < at ? { ...version, newer: true as const } : version],
        ),
    };
};
// ほかの内蔵ソフト（いまの版 other、過去の版 other-1・other-0）
const other: BuiltinGame = {
    ...tamers("v3"),
    id: "linktest",
    name: "通信テスト",
    sha256: "other",
    pastVersions: [
        { sha256: "other-1", saveFormat: 1 },
        { sha256: "other-0", saveFormat: 1 },
    ],
};

const noPending = (): boolean => false;

// 起動して掃除する（いまの版は current。利用者の ROM は romIds）
const startUp = (
    storage: Storage,
    current = "v4",
    romIds: string[] = [],
): number =>
    pruneGameSaves(storage, [tamers(current), other], romIds, noPending);

const played = (sha256: string, saveFormat = 2): string =>
    JSON.stringify({ sha256, saveFormat });

const saves = (...ids: string[]): Record<string, string> =>
    Object.fromEntries(ids.map(id => [`sram:${id}`, id.toUpperCase()]));

describe("自動の掃除（起動時）", () => {
    it("いまの版と 1 つ前の版は残り、それより古い同じ形式の版は消える", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v4"),
            ...saves("v4", "v3", "v2"),
            "rtc:v2": "RTC2",
        });
        assert.equal(startUp(storage), 2);
        assert.deepEqual(storage.keys(), [
            "builtinSave:tamers-life-gba",
            "sram:v3",
            "sram:v4",
        ]);
    });

    it("saveFormat ごとに、端末にあるいちばん新しい版が残る", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v4"),
            ...saves("v4", "v3", "v2", "v1", "v0"),
        });
        assert.equal(startUp(storage), 2);
        assert.deepEqual(storage.keys(), [
            "builtinSave:tamers-life-gba",
            "sram:v1",
            "sram:v3",
            "sram:v4",
        ]);
    });

    it("saveFormat の分からない版は残る", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v4"),
            ...saves("v4", "v3", "vx"),
        });
        assert.equal(startUp(storage), 0);
    });

    it("版を戻して公開したとき、いまの版より新しい版のセーブは残る", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v3"),
            ...saves("v5", "v4", "v3", "v2"),
        });
        // いまの版は v3（v5・v4 はいまの版より新しい。v2 は 1 つ前の版）
        assert.equal(startUp(storage, "v3"), 0);
        assert.deepEqual(storage.keys(), [
            "builtinSave:tamers-life-gba",
            "sram:v2",
            "sram:v3",
            "sram:v4",
            "sram:v5",
        ]);
    });

    it("版を戻したとき、1 つ前の版は「いまの版より古い中で」いちばん新しい版", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v5"),
            ...saves("v5", "v3", "v2", "v1"),
        });
        // いまの版は v4。v5 は新しいので残り、v3 が 1 つ前、v2 は消え、v1 は形式 1 の最新で残る
        assert.equal(startUp(storage, "v4"), 1);
        assert.deepEqual(storage.keys(), [
            "builtinSave:tamers-life-gba",
            "sram:v1",
            "sram:v3",
            "sram:v5",
        ]);
    });

    it("roms にある ID と、過去の版の一覧に無い ID は残る（roms が空でも）", () => {
        const entries = {
            "builtinSave:tamers-life-gba": played("v4"),
            ...saves("v4", "v3", "v2", "v1", "v0", "user-rom"),
            "rtc:user-rom": "USER",
        };
        const storage = new MemoryStorage(entries);
        assert.equal(startUp(storage, "v4", ["v2"]), 1);
        assert.equal(storage.getItem("sram:v2"), "V2");
        assert.equal(storage.getItem("sram:v0"), null);
        assert.equal(storage.getItem("sram:user-rom"), "USER-ROM");
        assert.equal(storage.getItem("rtc:user-rom"), "USER");
    });

    it("前に遊んだ版（まだ新しい版を開いていない）は、古くても残る", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v2"),
            ...saves("v3", "v2"),
        });
        assert.equal(startUp(storage), 0);
        assert.equal(storage.getItem("sram:v2"), "V2");
    });

    it("書き込み待ち・-corrupt:・ほかのキー・ほかの内蔵ソフトのいまの版には触れない", () => {
        const entries = {
            "builtinSave:tamers-life-gba": played("v4"),
            "builtinSave:linktest": played("other", 1),
            ...saves("v4", "v3", "v2", "other", "other-1", "other-0"),
            "sram-corrupt:v2": "BROKEN",
            "rtc-corrupt:v2:123": "BROKEN",
            controlLayout: "one-hand-a",
            "guide:settings": "{}",
        };
        const storage = new MemoryStorage(entries);
        // v2 は書き込み待ちなので残る。ほかの内蔵ソフトは、いまの版・1 つ前の版（other-1）が残り、other-0 だけ消える
        assert.equal(
            pruneGameSaves(
                storage,
                [tamers("v4"), other],
                [],
                key => key === "sram:v2",
            ),
            1,
        );
        assert.equal(storage.getItem("sram:v2"), "V2");
        // 書き込み待ちが無くなれば v2 も消える
        assert.equal(startUp(storage), 1);
        const rest: Record<string, string> = { ...entries };
        delete rest["sram:v2"];
        delete rest["sram:other-0"];
        assert.deepEqual(storage.keys(), Object.keys(rest).sort());
    });

    it("読めない記録があれば何も消さない", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": "{broken",
            ...saves("v4", "v3", "v2"),
        });
        assert.equal(startUp(storage), 0);
    });
});

describe("前のレビューの再現でも、いまの版と 1 つ前の版が残る", () => {
    it("新しい版のゲームが前のセーブを読めずに作り直してセーブしても、1 つ前の版は自動では消えない", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v3"),
            "sram:v3": "PROGRESS",
        });
        carryOverSaveIn(storage, tamers("v4"));
        assert.equal(storage.getItem("sram:v4"), "PROGRESS");
        storage.setItem("sram:v4", "FRESH!!!"); // 作り直した
        for (let i = 0; i < 3; i++) {
            carryOverSaveIn(storage, tamers("v4"));
            assert.equal(startUp(storage), 0);
            assert.equal(storage.getItem("sram:v3"), "PROGRESS");
        }
    });

    it("版を戻して公開した（いまの版にもうセーブがあって写さなかった）あとも、新しい版のセーブは残る", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v4"),
            "sram:v4": "V4SAVE",
            "sram:v3": "V3SAVE",
        });
        carryOverSaveIn(storage, tamers("v3"));
        assert.equal(storage.getItem("sram:v3"), "V3SAVE");
        storage.setItem("sram:v3", "V3MORE");
        assert.equal(startUp(storage, "v3"), 0);
        assert.equal(storage.getItem("sram:v4"), "V4SAVE");
    });

    it("PR より前の記録と、saveFormat を上げる前の版のセーブも残る", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v2"),
            ...saves("v2", "v1"),
        });
        assert.equal(startUp(storage), 0);
        assert.equal(storage.getItem("sram:v1"), "V1");
    });
});

describe("メニューの「古い版のセーブを消す」", () => {
    it("いまの版以外の過去の版を、ソフトごとに数える", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v4"),
            "builtinSave:linktest": played("other", 1),
            ...saves("v4", "v3", "v1", "vx", "other", "other-1"),
        });
        assert.deepEqual(
            manualStaleVersions(storage, [tamers("v4"), other], []).map(
                ({ game, ids }) => [game.name, ids],
            ),
            [
                ["テイマーズライフ", ["v3", "v1", "vx"]],
                ["通信テスト", ["other-1"]],
            ],
        );
    });

    it("消すと、いまの版だけ残る（roms にある ID・-corrupt:・ほかのキー・一覧に無い ID は残る）", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v4"),
            ...saves("v5", "v4", "v3", "v2", "vx", "user-rom"),
            "rtc:v3": "RTC3",
            "sram-corrupt:v3": "BROKEN",
            controlLayout: "one-hand-a",
        });
        const removed = removeManualStaleSaves(
            storage,
            [tamers("v4")],
            ["v2"],
            noPending,
        );
        assert.equal(removed, 4); // v5（いまの版より新しい）・v3 の sram と rtc・vx
        assert.deepEqual(storage.keys(), [
            "builtinSave:tamers-life-gba",
            "controlLayout",
            "sram-corrupt:v3",
            "sram:user-rom",
            "sram:v2",
            "sram:v4",
        ]);
        assert.deepEqual(manualStaleVersions(storage, [tamers("v4")], ["v2"]), []);
    });

    it("まだ新しい版を開いていない（前に遊んだ版がいまの版でない）ときは、前に遊んだ版を消さない", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v3"),
            ...saves("v3", "v2"),
        });
        assert.deepEqual(
            manualStaleVersions(storage, [tamers("v4")], []).map(({ ids }) => ids),
            [["v2"]],
        );
        removeManualStaleSaves(storage, [tamers("v4")], [], noPending);
        assert.equal(storage.getItem("sram:v3"), "V3");
    });

    it("古い版が無ければ空（メニューのボタンは押せない）", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v4"),
            ...saves("v4", "user-rom"),
        });
        assert.deepEqual(manualStaleVersions(storage, [tamers("v4")], []), []);
    });

    it("書き込み待ちのある版は消さない", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v4"),
            ...saves("v4", "v3"),
        });
        assert.equal(
            removeManualStaleSaves(
                storage,
                [tamers("v4")],
                [],
                key => key === "sram:v3",
            ),
            0,
        );
    });
});

describe("写す所（carryOverSave）", () => {
    it("前の版から写し、何も消さない", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v3"),
            "sram:v3": "SAVE",
            "rtc:v3": "RTC",
        });
        carryOverSaveIn(storage, tamers("v4"));
        assert.deepEqual(storage.keys(), [
            "builtinSave:tamers-life-gba",
            "rtc:v3",
            "rtc:v4",
            "sram:v3",
            "sram:v4",
        ]);
        assert.equal(storage.getItem("sram:v4"), "SAVE");
        assert.equal(
            storage.getItem("builtinSave:tamers-life-gba"),
            played("v4"),
        );
    });

    it("いまの版にもうあれば上書きしない", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v3"),
            "sram:v3": "OLD",
            "sram:v4": "NEW",
        });
        carryOverSaveIn(storage, tamers("v4"));
        assert.equal(storage.getItem("sram:v4"), "NEW");
        assert.equal(storage.getItem("sram:v3"), "OLD");
    });

    it("saveFormat が違えば写さない", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v1", 1),
            "sram:v1": "F1",
        });
        carryOverSaveIn(storage, tamers("v2", 2));
        assert.equal(storage.getItem("sram:v2"), null);
        assert.equal(storage.getItem("sram:v1"), "F1");
    });

    it("いまの版のキーが空文字なら記録を進めず、次の起動の掃除でも前の版が残る", () => {
        const storage = new MemoryStorage({
            "builtinSave:tamers-life-gba": played("v2"),
            ...saves("v2"),
            "sram:v3": "",
            "sram:v4": "",
        });
        carryOverSaveIn(storage, tamers("v4"));
        assert.equal(
            storage.getItem("builtinSave:tamers-life-gba"),
            played("v2"),
        );
        assert.equal(startUp(storage), 0);
        assert.equal(storage.getItem("sram:v2"), "V2");
    });

    it("写すのに失敗したら記録を進めず、掃除でも前の版が残る", () => {
        const storage = new FullStorage(
            {
                "builtinSave:tamers-life-gba": played("v2"),
                ...saves("v2"),
                "sram:v3": "SKIPPED",
            },
            "sram:v4",
        );
        assert.throws(() => carryOverSaveIn(storage, tamers("v4")));
        assert.equal(startUp(storage), 0);
        assert.equal(storage.getItem("sram:v2"), "V2");
    });
});

describe("セーブステート", () => {
    it("過去の版の枠は消し、いまの版・利用者の ROM の枠は残す", () => {
        assert.deepEqual(
            staleSaveStateIds(
                ["v5", "v3", "v4", "user-rom", "other", "other-0", 42],
                [tamers("v4"), other],
                ["v3"],
            ),
            ["v5", "other-0"],
        );
    });
});
