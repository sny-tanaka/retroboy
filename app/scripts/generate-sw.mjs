// vite build のあとに実行し、dist/sw.js（Service Worker）を作る。
//
// - dist の中身（sw.js 自身を除く）を事前キャッシュの一覧にする。index.html は "./" として入れる。
// - dist の中身のハッシュを版（VERSION）にする。中身が 1 バイトでも変われば sw.js も変わり、
//   ブラウザが新しい Service Worker を入れて古いキャッシュを消す。
// - ROM・セーブ・セーブステートが dist に紛れ込んでいたら失敗させる（設計書 6 章）。
//   例外は内蔵ソフト（自作ゲーム）だけ: dist/builtin/index.json の目録に載っていて、
//   中身の SHA-256 と大きさが目録と合う ROM は通す（plugins/builtinGames.ts が出す。docs/builtin-games.md）。
//   内蔵ソフトの ROM と目録も事前キャッシュに入るので、オフラインでも選べる。
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(appDir, "dist");
const templatePath = join(appDir, "sw", "sw.template.js");

// 配信してはいけないもの: ROM・セーブステート・セーブ RAM
const FORBIDDEN = /\.(gb|gbc|rbs|sav|srm)$/i;
// 内蔵ソフトの置き場と目録
const BUILTIN_DIR = "builtin/";
const BUILTIN_INDEX = `${BUILTIN_DIR}index.json`;
// キャッシュに入れないもの: Service Worker 自身、ソースマップ、Netlify の設定ファイル
const SKIP = new Set(["sw.js", "_headers", "_redirects"]);

async function listFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await listFiles(path)));
        else files.push(path);
    }
    return files;
}

const files = (await listFiles(distDir))
    .map((path) => relative(distDir, path).split(sep).join("/"))
    .sort();

// 目録に載っている内蔵ソフトの ROM。目録と中身が合わなければ失敗させる
async function readBuiltinRoms() {
    if (!files.includes(BUILTIN_INDEX)) return new Set();
    const { games } = JSON.parse(
        await readFile(join(distDir, BUILTIN_INDEX), "utf8"),
    );
    const allowed = new Set();
    for (const game of games) {
        const ok =
            typeof game.file === "string" &&
            game.file.startsWith(BUILTIN_DIR) &&
            !game.file.slice(BUILTIN_DIR.length).includes("/") &&
            files.includes(game.file);
        if (!ok) {
            console.error(`内蔵ソフトの目録の ROM が dist/builtin にありません: ${game.file}`);
            process.exit(1);
        }
        const data = await readFile(join(distDir, game.file));
        const sha256 = createHash("sha256").update(data).digest("hex");
        if (sha256 !== game.sha256 || data.length !== game.size) {
            console.error(`内蔵ソフトの ROM が目録と合いません: ${game.file}`);
            process.exit(1);
        }
        allowed.add(game.file);
    }
    return allowed;
}

const builtinRoms = await readBuiltinRoms();
const forbidden = files.filter(
    (path) => FORBIDDEN.test(path) && !builtinRoms.has(path),
);
if (forbidden.length > 0) {
    console.error(
        `dist に ROM かセーブが入っています。配信できません: ${forbidden.join(", ")}`,
    );
    process.exit(1);
}

const cached = files.filter(
    (path) => !SKIP.has(path) && !path.endsWith(".map"),
);

const hash = createHash("sha256");
for (const path of cached) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(distDir, path)));
    hash.update("\0");
}
const template = await readFile(templatePath, "utf8");
hash.update(template);
const version = hash.digest("hex").slice(0, 16);

const precache = cached.map((path) => (path === "index.html" ? "./" : path));

const header =
    `const VERSION = ${JSON.stringify(version)};\n` +
    `const PRECACHE = ${JSON.stringify(precache, null, 4)};\n\n`;
await writeFile(join(distDir, "sw.js"), header + template);

console.log(
    `dist/sw.js を書き出しました（版 ${version}、キャッシュするファイル ${precache.length} 個、うち内蔵ソフトの ROM ${builtinRoms.size} 個）`,
);
