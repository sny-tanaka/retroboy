/// <reference types="node" />
import { execSync } from "node:child_process";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// git の結果。git が無い・リポジトリの外などで失敗したら null
const git = (args: string): string | null => {
    try {
        return execSync(`git ${args}`, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
    } catch {
        return null;
    }
};

// アプリの版（画面に出す）。ビルドした日時（日本時間）と git の短いコミットハッシュ。
// 作業ツリーにコミットしていない変更（追跡していないファイルも含む）があればハッシュの後ろに "+" を付ける。
// 例: "2026-10-24 12:34 (abc1234)"。Service Worker の版（dist の中身のハッシュ）とは別物
const buildAppVersion = (): string => {
    const builtAt = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date());
    const commit = git("rev-parse --short HEAD");
    if (!commit) return builtAt;
    const dirty = git("status --porcelain") !== "";
    return `${builtAt} (${commit}${dirty ? "+" : ""})`;
};

const appVersion = buildAppVersion();
// 新しい版かどうかの判定に使う、ビルドごとに違う印（表示の版は分単位なので、同じ分のビルドを見分けられない）
const buildId = new Date().toISOString();

// dist/version.json に版とビルドの印を書き出す。開いている画面が、新しく入った Service Worker の
// キャッシュにあるビルドの印と自分のものを比べるのに使う（src/pwa/registerServiceWorker.ts）
const versionFile = (): Plugin => ({
    name: "retroboy-snap-version-file",
    apply: "build",
    generateBundle() {
        this.emitFile({
            type: "asset",
            fileName: "version.json",
            source: JSON.stringify({ version: appVersion, buildId }),
        });
    },
});

export default defineConfig({
    plugins: [react(), versionFile()],
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
        __BUILD_ID__: JSON.stringify(buildId),
    },
});
