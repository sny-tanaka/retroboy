// vite build のあとに実行し、dist/sw.js（Service Worker）を作る。
//
// - dist の中身（sw.js 自身を除く）を事前キャッシュの一覧にする。index.html は "./" として入れる。
// - dist の中身のハッシュを版（VERSION）にする。中身が 1 バイトでも変われば sw.js も変わり、
//   ブラウザが新しい Service Worker を入れて古いキャッシュを消す。
// - ROM・セーブ・セーブステートが dist に紛れ込んでいたら失敗させる（設計書 6 章）。
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(appDir, "dist");
const templatePath = join(appDir, "sw", "sw.template.js");

// 配信してはいけないもの: ROM・セーブステート・セーブ RAM
const FORBIDDEN = /\.(gb|gbc|rbs|sav|srm)$/i;
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

const forbidden = files.filter((path) => FORBIDDEN.test(path));
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
    `dist/sw.js を書き出しました（版 ${version}、キャッシュするファイル ${precache.length} 個）`,
);
