/// <reference types="node" />
// 内蔵ソフト（リポジトリの games/<id>/）をアプリに入れる vite のプラグイン。決まりは docs/builtin-games.md。
//
// - games/*/game.json を読み、ROM の SHA-256・大きさを測って目録を作る。git に入っている ROM の履歴から、
//   これまでの版（pastVersions。新しい順に SHA-256 とそのときの saveFormat）も入れる。git の履歴に無い古い版
//   （ソースを別のリポジトリに移して、このリポジトリの履歴から消したもの）は games/<id>/past-versions.json に書いておき、後ろに足す。
// - 攻略サイト（game.json の "guide"）は、games/<id>/ の同じ名前のフォルダにできたもの（index.html と、その参照する物）を置き、
//   本番ビルドでは dist/<guide> にそのまま写す。開発サーバーでは /<guide> の下で同じものを返す。
// - アプリには目録を virtual:builtin-games として渡す（JS に入るので、目録を取りに行く通信は要らない）。
// - 本番ビルドでは dist/builtin/ に ROM（名前に SHA-256 の頭を付ける）と目録 index.json を出す。
//   scripts/generate-sw.mjs は index.json に載っている ROM だけを配信してよいものとして通す。
// - 開発サーバーでは /builtin/ の下で同じものを返す。games/ を書き換えたら読み直して画面を再読み込みする。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
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
const GUIDE_PATTERN = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*\/$/;

interface LoadedGame {
    readonly game: BuiltinGame;
    readonly romPath: string;
    readonly data: Buffer;
    /** 攻略サイトのできたもののフォルダ（games/<id>/<guide>。"guide" が無ければ null） */
    readonly guideDir: string | null;
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
    // 攻略サイト（任意）: アプリと一緒に出す dist の中のフォルダ（例: guide/）。games/<id>/ の同じ名前のフォルダにできたものを置く
    const guide = json.guide;
    if (guide !== undefined && (typeof guide !== "string" || !GUIDE_PATTERN.test(guide))) {
        fail(id, `"guide" は dist の中のフォルダ（例: "guide/"）にしてください。`);
    }
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
            pastVersions: [], // loadGames で入れる
            ...(guide === undefined ? {} : { guide: guide as string }),
        },
        romPath,
        data,
        guideDir: guide === undefined ? null : resolve(GAMES_DIR, id, guide as string),
    };
};

// 攻略サイトのフォルダの中のファイル（フォルダからの相対パス、/ 区切り、名前の順）
const listGuideFiles = async (dir: string): Promise<string[]> => {
    const walk = async (at: string): Promise<string[]> => {
        const entries = await readdir(at, { withFileTypes: true });
        const files = await Promise.all(
            entries
                .filter(entry => !entry.name.startsWith("."))
                .map(entry => (entry.isDirectory() ? walk(join(at, entry.name)) : Promise.resolve([join(at, entry.name)]))),
        );
        return files.flat();
    };
    return (await walk(dir)).map(path => relative(dir, path).split(sep).join("/")).sort();
};

// 攻略サイトに index.html があるか（無ければビルドを止める）
const checkGuide = async ({ game, guideDir }: LoadedGame): Promise<void> => {
    if (guideDir === null) return;
    const index = await stat(join(guideDir, "index.html")).catch(() => null);
    if (!index?.isFile()) {
        fail(game.id, `攻略サイト（"guide": "${game.guide}"）の games/${game.id}/${game.guide}index.html がありません。`);
    }
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
};

// ROM の git の履歴の blob の ID → 中身の SHA-256（ROM は 1 版で数 MB あるので、読んだものを覚えておく）
const HISTORY_CACHE = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/.cache/builtin-rom-history.json");

const git = (args: string[], input?: string): Buffer =>
    execFileSync("git", ["-C", GAMES_DIR, ...args], {
        input,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["pipe", "pipe", "ignore"],
    });

// git cat-file --batch で、名前（<コミット>:<パス> や blob の ID）ごとに中身を読む（並びは names と同じ。無ければ null）。
// 出力は「<oid> blob <長さ>\n<中身>\n」か「<名前> missing\n」の並び
const readBlobs = (names: readonly string[]): (Buffer | null)[] => {
    if (names.length === 0) return [];
    const out = git(["cat-file", "--batch"], names.map(name => `${name}\n`).join(""));
    const blobs: (Buffer | null)[] = [];
    let at = 0;
    while (at < out.length && blobs.length < names.length) {
        const end = out.indexOf(0x0a, at);
        if (end < 0) break;
        const header = out.subarray(at, end).toString().split(" ");
        at = end + 1;
        if (header[1] !== "blob") {
            blobs.push(null);
            continue;
        }
        const size = Number(header[2]);
        blobs.push(out.subarray(at, at + size));
        at += size + 1;
    }
    if (blobs.length !== names.length) throw new Error("git cat-file の出力を読めませんでした。");
    return blobs;
};

// ある版の game.json の saveFormat（無い・読めなければ undefined＝分からない）
const saveFormatOf = (json: Buffer | null): number | undefined => {
    if (!json) return undefined;
    try {
        const value = (JSON.parse(json.toString()) as Record<string, unknown>).saveFormat ?? 1;
        return Number.isInteger(value) ? (value as number) : undefined;
    } catch {
        return undefined;
    }
};

/**
 * git に入っている ROM の、これまでの版（新しい順）。sha256 は ROM の中身の SHA-256、saveFormat はそのコミットの
 * games/<id>/game.json の値（分からなければ無し）。ROM を git に入れていない・git が無ければ空
 * （一覧に無い版のセーブは消さないので、足りない分は「消さない」側に倒れる）
 */
const readRomHistory = async (
    id: string,
    romPath: string,
    cache: Record<string, string>,
): Promise<BuiltinGame["pastVersions"]> => {
    try {
        // 名前を変えた前も辿る。コミットの行のあとに「:<旧 mode> <新 mode> <旧 blob> <新 blob> <状態>\t<パス>」が続く
        const log = git(["log", "--follow", "--format=commit %H", "--raw", "--no-abbrev", "--", romPath]).toString();
        const commits: { commit: string; oid: string }[] = [];
        let commit: string | null = null;
        for (const line of log.split("\n")) {
            const header = /^commit ([0-9a-f]+)$/.exec(line);
            if (header) {
                commit = header[1];
                continue;
            }
            const raw = /^:\S+ \S+ [0-9a-f]+ ([0-9a-f]+) /.exec(line);
            if (raw && commit && !/^0+$/.test(raw[1])) commits.push({ commit, oid: raw[1] });
        }
        // ROM の中身の SHA-256（覚えていないものだけ、少しずつ読む）
        const missing = [...new Set(commits.map(({ oid }) => oid))].filter(oid => !cache[oid]);
        for (let i = 0; i < missing.length; i += 16) {
            const chunk = missing.slice(i, i + 16);
            readBlobs(chunk).forEach((blob, index) => {
                if (blob) cache[chunk[index]] = createHash("sha256").update(blob).digest("hex");
            });
        }
        const formats = readBlobs(commits.map(({ commit }) => `${commit}:games/${id}/game.json`)).map(saveFormatOf);
        const versions = new Map<string, number | undefined>();
        commits.forEach(({ oid }, index) => {
            const sha256 = cache[oid];
            // 同じ中身の版が何度か出てきたら（戻したとき）、いちばん新しいものの位置と形式にする
            if (sha256 && !versions.has(sha256)) versions.set(sha256, formats[index]);
        });
        return [...versions].map(([sha256, saveFormat]) => ({
            sha256,
            ...(saveFormat === undefined ? {} : { saveFormat }),
        }));
    } catch {
        return [];
    }
};

// git の履歴に無い古い版（games/<id>/past-versions.json。新しい順の [{ sha256, saveFormat? }]。無ければ空）
const readFrozenHistory = async (id: string): Promise<BuiltinGame["pastVersions"]> => {
    const text = await readFile(join(GAMES_DIR, id, "past-versions.json"), "utf8").catch(() => null);
    if (text === null) return [];
    const list = JSON.parse(text) as unknown;
    const ok =
        Array.isArray(list) &&
        list.every(
            (v: unknown) =>
                typeof v === "object" &&
                v !== null &&
                typeof (v as { sha256?: unknown }).sha256 === "string" &&
                /^[0-9a-f]{64}$/.test((v as { sha256: string }).sha256) &&
                ((v as { saveFormat?: unknown }).saveFormat === undefined ||
                    Number.isInteger((v as { saveFormat?: unknown }).saveFormat)),
        );
    if (!ok) fail(id, "past-versions.json は [{ \"sha256\": \"<64 桁>\", \"saveFormat\": <整数> }] の並びにしてください。");
    return (list as { sha256: string; saveFormat?: number }[]).map(({ sha256, saveFormat }) => ({
        sha256,
        ...(saveFormat === undefined ? {} : { saveFormat }),
    }));
};

/** 内蔵ソフトごとの、これまでの版（新しい順。いまの内蔵ソフトのどれかの版は除く） */
const loadPastVersions = async (
    games: readonly LoadedGame[],
): Promise<Map<string, BuiltinGame["pastVersions"]>> => {
    const cache: Record<string, string> = await readFile(HISTORY_CACHE, "utf8").then(
        text => JSON.parse(text) as Record<string, string>,
        () => ({}),
    );
    const size = Object.keys(cache).length;
    const current = new Set(games.map(({ game }) => game.sha256));
    const result = new Map<string, BuiltinGame["pastVersions"]>();
    for (const { game, romPath } of games) {
        // git の履歴（新しい）のあとに、履歴から消した古い版を足す（同じ中身の版は新しいほうの位置と形式にする）
        const recent = await readRomHistory(game.id, romPath, cache);
        const seenVersions = new Set(recent.map(({ sha256 }) => sha256));
        const history = [
            ...recent,
            ...(await readFrozenHistory(game.id)).filter(({ sha256 }) => !seenVersions.has(sha256)),
        ];
        // 版を戻して公開したときは、履歴の中でいまの版より新しい版に newer を付ける（自動では消さない）。
        // いまの版が履歴に無い（コミットしていない）ときは、どれもいまの版より古い
        const at = history.findIndex(({ sha256 }) => sha256 === game.sha256);
        result.set(
            game.id,
            history
                .map((version, index) => (index < at ? { ...version, newer: true as const } : version))
                .filter(({ sha256 }) => !current.has(sha256)),
        );
    }
    if (Object.keys(cache).length !== size) {
        await mkdir(dirname(HISTORY_CACHE), { recursive: true });
        await writeFile(HISTORY_CACHE, JSON.stringify(cache));
    }
    return result;
};

// games/ の下の game.json があるフォルダを、名前の順に読む。"builtin": false のもの（内蔵ソフトから外したゲーム）は読まない
const loadGames = async (): Promise<LoadedGame[]> => {
    const entries = await readdir(GAMES_DIR, { withFileTypes: true }).catch(() => []);
    const ids = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const json = await readFile(join(GAMES_DIR, entry.name, "game.json"), "utf8").then(
            text => text,
            () => null,
        );
        if (json === null) continue;
        const parsed = JSON.parse(json) as Record<string, unknown>;
        if (parsed.builtin !== undefined && typeof parsed.builtin !== "boolean") {
            fail(entry.name, `"builtin" は true か false にしてください。`);
        }
        if (parsed.builtin === false) continue;
        ids.push(entry.name);
    }
    const games = await Promise.all(ids.sort().map(loadGame));
    await Promise.all(games.map(checkGuide));
    const seen = new Map<string, string>();
    for (const { game } of games) {
        const other = seen.get(game.sha256);
        if (other) fail(game.id, `ROM が games/${other} と同じです。`);
        seen.set(game.sha256, game.id);
    }
    const past = await loadPastVersions(games);
    return games.map(loaded => ({
        ...loaded,
        game: { ...loaded.game, pastVersions: past.get(loaded.game.id) ?? [] },
    }));
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
            for (const { game, guideDir } of loaded) {
                if (guideDir === null || game.guide === undefined) continue;
                for (const name of await listGuideFiles(guideDir)) {
                    this.emitFile({
                        type: "asset",
                        fileName: `${game.guide}${name}`,
                        source: await readFile(join(guideDir, name)),
                    });
                }
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
            // 攻略サイト: /<guide> の下のファイル（フォルダの URL は index.html）
            server.middlewares.use((req, res, next) => {
                const url = decodeURIComponent(req.url?.split("?")[0] ?? "");
                if (!url.startsWith(server.config.base)) {
                    next();
                    return;
                }
                const path = url.slice(server.config.base.length);
                games().then(
                    loaded => {
                        const found = loaded.find(
                            ({ game }) => game.guide !== undefined && (path.startsWith(game.guide) || `${path}/` === game.guide),
                        );
                        if (!found?.guideDir || found.game.guide === undefined) {
                            next();
                            return;
                        }
                        if (`${path}/` === found.game.guide) {
                            res.statusCode = 301;
                            res.setHeader("Location", `${server.config.base}${found.game.guide}`);
                            res.end();
                            return;
                        }
                        const rest = path.slice(found.game.guide.length) || "index.html";
                        const file = resolve(found.guideDir, rest.endsWith("/") ? `${rest}index.html` : rest);
                        if (!file.startsWith(`${found.guideDir}${sep}`) && file !== found.guideDir) {
                            next();
                            return;
                        }
                        readFile(file).then(
                            data => {
                                res.setHeader("Content-Type", CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
                                res.end(data);
                            },
                            () => next(),
                        );
                    },
                    (err: unknown) => next(err),
                );
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
