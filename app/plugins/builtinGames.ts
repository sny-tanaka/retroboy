/// <reference types="node" />
// 内蔵ソフト（リポジトリの games/<id>/）をアプリに入れる vite のプラグイン。決まりは docs/builtin-games.md。
//
// - games/*/game.json を読み、ROM の SHA-256・大きさを測って目録を作る。
// - アプリには目録を virtual:builtin-games として渡す（JS に入るので、目録を取りに行く通信は要らない）。
// - 本番ビルドでは dist/builtin/ に ROM（名前に SHA-256 の頭を付ける）と目録 index.json を出す。
//   scripts/generate-sw.mjs は index.json に載っている ROM だけを配信してよいものとして通す。
// - 開発サーバーでは /builtin/ の下で同じものを返す。games/ を書き換えたら読み直して画面を再読み込みする。
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import type { BuiltinGame, BuiltinSystem } from "../src/storage/builtinGame.ts";

const GAMES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../games");
const OUT_DIR = "builtin";
const VIRTUAL_ID = "virtual:builtin-games";
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;

// app/src/storage/romSystem.ts と同じ（アプリが受け付ける ROM の大きさ）
const MIN_ROM_SIZE = 0x150;
const MAX_GB_ROM_SIZE = 8 * 1024 * 1024;
const MAX_GBA_ROM_SIZE = 32 * 1024 * 1024;
const EXTENSIONS: Readonly<Record<BuiltinSystem, string>> = { gb: "gb", gbc: "gbc", gba: "gba" };
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

interface LoadedGame {
    readonly game: BuiltinGame;
    readonly romPath: string;
    readonly data: Buffer;
}

const fail = (id: string, message: string): never => {
    throw new Error(`games/${id}/game.json: ${message}`);
};

const requireString = (id: string, json: Record<string, unknown>, key: string): string => {
    const value = json[key];
    if (typeof value !== "string" || value.trim() === "") {
        fail(id, `"${key}" を文字列で書いてください。`);
    }
    return value as string;
};

const loadGame = async (id: string): Promise<LoadedGame> => {
    if (!ID_PATTERN.test(id)) {
        fail(id, "フォルダ名は英小文字・数字・- だけにしてください。");
    }
    const dir = join(GAMES_DIR, id);
    const json = JSON.parse(await readFile(join(dir, "game.json"), "utf8")) as Record<string, unknown>;
    const name = requireString(id, json, "name");
    const description = requireString(id, json, "description");
    const system = requireString(id, json, "system");
    if (system !== "gb" && system !== "gbc" && system !== "gba") {
        fail(id, `"system" は "gb"・"gbc"・"gba" のどれかにしてください。`);
    }
    const saveFormat = json.saveFormat ?? 1;
    if (!Number.isInteger(saveFormat)) {
        fail(id, `"saveFormat" は整数にしてください。`);
    }
    const romPath = resolve(dir, requireString(id, json, "rom"));
    const data = await readFile(romPath).catch((err: unknown) =>
        fail(id, `ROM（${romPath}）を読めません。scripts/build-games.sh でビルドしてください。${String(err)}`),
    );
    if (system === "gba") {
        if (data.length < MIN_ROM_SIZE || data.length > MAX_GBA_ROM_SIZE) {
            fail(id, "ROM の大きさが GBA の ROM として合いません。");
        }
        // アプリはヘッダで GBA かを見分ける（app/src/storage/romSystem.ts の isGbaHeader と同じ）
        if (data[3] !== 0xea || data[0xb2] !== 0x96) {
            fail(id, `"system" が "gba" ですが、ROM のヘッダが GBA の形（3 バイト目が 0xEA、0xB2 が 0x96）ではありません。`);
        }
        return makeGame(id, json, name, description, "gba", romPath, data);
    }
    if (data.length < MIN_ROM_SIZE || data.length > MAX_GB_ROM_SIZE) {
        fail(id, "ROM の大きさが Game Boy の ROM として合いません。");
    }
    // ヘッダの CGB フラグ（0x143 の bit 7）と "system" が合っているか。アプリはヘッダで GB / GBC を決める
    const cgb = (data[0x143] & 0x80) !== 0;
    if (cgb !== (system === "gbc")) {
        fail(id, `"system" が "${system}" ですが、ROM のヘッダの CGB フラグは${cgb ? "立っています" : "立っていません"}。`);
    }
    // コアはヘッダの RAM サイズ（0x149）が 0〜5 以外だと panic する（useRomSession.ts の hasValidRamSize）
    if (data[0x149] > 0x05) {
        fail(id, "ROM のヘッダの RAM サイズ（0x149）が 0〜5 ではありません。");
    }
    return makeGame(id, json, name, description, system as BuiltinSystem, romPath, data);
};

const makeGame = (
    id: string,
    json: Record<string, unknown>,
    name: string,
    description: string,
    system: BuiltinSystem,
    romPath: string,
    data: Buffer,
): LoadedGame => {
    const saveFormat = json.saveFormat ?? 1;
    const sha256 = createHash("sha256").update(data).digest("hex");
    const extension = EXTENSIONS[system];
    return {
        game: {
            id,
            name,
            description,
            system,
            sha256,
            size: data.length,
            file: `${OUT_DIR}/${id}-${sha256.slice(0, 12)}.${extension}`,
            saveFormat: saveFormat as number,
        },
        romPath,
        data,
    };
};

// games/ の下の game.json があるフォルダを、名前の順に読む
const loadGames = async (): Promise<LoadedGame[]> => {
    const entries = await readdir(GAMES_DIR, { withFileTypes: true }).catch(() => []);
    const ids = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const hasJson = await readFile(join(GAMES_DIR, entry.name, "game.json")).then(
            () => true,
            () => false,
        );
        if (hasJson) ids.push(entry.name);
    }
    const games = await Promise.all(ids.sort().map(loadGame));
    const seen = new Map<string, string>();
    for (const { game } of games) {
        const other = seen.get(game.sha256);
        if (other) fail(game.id, `ROM が games/${other} と同じです。`);
        seen.set(game.sha256, game.id);
    }
    return games;
};

export const builtinGames = (): Plugin => {
    let cache: Promise<LoadedGame[]> | null = null;
    const games = () => (cache ??= loadGames());
    return {
        name: "retroboy-snap-builtin-games",
        resolveId(id) {
            return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null;
        },
        async load(id) {
            if (id !== RESOLVED_VIRTUAL_ID) return null;
            // 書き換えの見張りは configureServer で行う（addWatchFile にフォルダを渡すと開発サーバーで読み込みに失敗する）
            const loaded = await games();
            return `export default ${JSON.stringify(loaded.map(({ game }) => game))};`;
        },
        async generateBundle() {
            const loaded = await games();
            for (const { game, data } of loaded) {
                this.emitFile({ type: "asset", fileName: game.file, source: data });
            }
            this.emitFile({
                type: "asset",
                fileName: `${OUT_DIR}/index.json`,
                source: JSON.stringify({ games: loaded.map(({ game }) => game) }, null, 4),
            });
        },
        configureServer(server) {
            // games/ と、games/ の外にある ROM（通信テストは testroms/）を見張る
            const romPaths = new Set<string>();
            const watch = (): void => {
                void games().then(loaded => {
                    for (const { romPath } of loaded) romPaths.add(romPath);
                    server.watcher.add([GAMES_DIR, ...romPaths]);
                }, () => undefined);
            };
            watch();
            server.watcher.on("all", (_event, path) => {
                if (!path.startsWith(`${GAMES_DIR}${sep}`) && !romPaths.has(path)) return;
                cache = null;
                watch();
                const module = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
                if (module) server.moduleGraph.invalidateModule(module);
                server.ws.send({ type: "full-reload" });
            });
            const prefix = `${server.config.base}${OUT_DIR}/`;
            server.middlewares.use((req, res, next) => {
                const url = req.url?.split("?")[0];
                if (!url?.startsWith(prefix)) {
                    next();
                    return;
                }
                const path = url.slice(server.config.base.length);
                games().then(
                    loaded => {
                        if (path === `${OUT_DIR}/index.json`) {
                            res.setHeader("Content-Type", "application/json");
                            res.end(JSON.stringify({ games: loaded.map(({ game }) => game) }, null, 4));
                            return;
                        }
                        const found = loaded.find(({ game }) => game.file === path);
                        if (!found) {
                            next();
                            return;
                        }
                        res.setHeader("Content-Type", "application/octet-stream");
                        res.end(found.data);
                    },
                    (err: unknown) => next(err),
                );
            });
        },
    };
};
