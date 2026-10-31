/// <reference types="node" />
// 配信物（dist/）にライセンスの文書を入れる vite のプラグイン（本番ビルドだけ）。一覧と出どころは NOTICE。
//
// - LICENSE.txt: このリポジトリの LICENSE（Apache-2.0）
// - NOTICE.txt: このリポジトリの NOTICE（使っているもの・出どころ・著作権表示）
// - licenses/retroboy-LICENSE.txt: コアの Retro Boy（smparsons/retroboy）の LICENSE（Apache-2.0）。
//   scripts/prepare-core.sh が取ってくる core/upstream/LICENSE
// - licenses/mgba-LICENSE.txt・blip_buf-LICENSE.txt・inih-LICENSE.txt: GBA のコアの mGBA（MPL-2.0）と、その中に入る
//   blip_buf（LGPL-2.1）・inih（BSD-3-Clause）。scripts/prepare-core.sh mgba が取ってくる mgba/upstream/ のもの
// - licenses/<名前>-LICENSE*.txt・misaki-font.txt: リポジトリの licenses/ に置いたもの（内蔵ソフトのテイマーズライフの ROM に入る美咲フォントの説明書と Rust のクレート〔agb・serde など〕・ブート ROM・WASM に入る Rust のクレートと標準ライブラリ・
//   mGBA の WASM に入る Emscripten の実行時・musl・compiler-rt・
//   npm にライセンスの全文が入っていない qrcode-generator）を、そのまま写す
// - licenses/<npm のパッケージ>-LICENSE.txt: JS のバンドルに入る npm のパッケージの LICENSE。バンドルは著作権表示を
//   残さないので、ここで全文を入れる。NPM_LICENSES に無いパッケージがバンドルに入ったらビルドを止める
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const APP = resolve(ROOT, "app");

const FILES: ReadonlyArray<{ readonly from: string; readonly to: string }> = [
    { from: "LICENSE", to: "LICENSE.txt" },
    { from: "NOTICE", to: "NOTICE.txt" },
    { from: "core/upstream/LICENSE", to: "licenses/retroboy-LICENSE.txt" },
    { from: "mgba/upstream/LICENSE", to: "licenses/mgba-LICENSE.txt" },
    { from: "mgba/upstream/src/third-party/blip_buf/license.txt", to: "licenses/blip_buf-LICENSE.txt" },
    { from: "mgba/upstream/src/third-party/inih/LICENSE.txt", to: "licenses/inih-LICENSE.txt" },
];

// バンドルに入る npm のパッケージと、その LICENSE（app/ からのパス）。null はリポジトリの licenses/ に置いたもの
const NPM_LICENSES: Readonly<Record<string, string | null>> = {
    react: "node_modules/react/LICENSE",
    "react-dom": "node_modules/react-dom/LICENSE",
    scheduler: "node_modules/scheduler/LICENSE",
    jsqr: "node_modules/jsqr/LICENSE",
    "qrcode-generator": null,
};

const read = (path: string): Promise<Buffer> =>
    readFile(path).catch((err: unknown) => {
        throw new Error(`ライセンスの文書（${path}）を読めません。${String(err)}`);
    });

// モジュールの id から npm のパッケージ名を取る（node_modules の外なら null）
const packageOf = (id: string): string | null => {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id.replaceAll("\\", "/"));
    return match ? match[1] : null;
};

export const licenseFiles = (): Plugin => ({
    name: "retroboy-snap-license-files",
    apply: "build",
    async generateBundle(_options, bundle) {
        const bundled = new Set<string>();
        for (const chunk of Object.values(bundle)) {
            if (chunk.type !== "chunk") continue;
            for (const id of chunk.moduleIds) {
                const name = packageOf(id);
                if (name) bundled.add(name);
            }
        }
        const missing = [...bundled].filter(name => !(name in NPM_LICENSES));
        if (missing.length > 0) {
            throw new Error(
                `ライセンスの全文を入れていない npm のパッケージがバンドルに入っています: ${missing.join(", ")}` +
                    "（app/plugins/licenseFiles.ts の NPM_LICENSES と NOTICE に足してください）",
            );
        }

        for (const { from, to } of FILES) {
            this.emitFile({ type: "asset", fileName: to, source: await read(resolve(ROOT, from)) });
        }
        for (const name of await readdir(resolve(ROOT, "licenses"))) {
            if (!name.endsWith(".txt")) continue;
            this.emitFile({
                type: "asset",
                fileName: `licenses/${name}`,
                source: await read(resolve(ROOT, "licenses", name)),
            });
        }
        for (const [name, path] of Object.entries(NPM_LICENSES)) {
            if (path === null) continue;
            this.emitFile({
                type: "asset",
                fileName: `licenses/${name}-LICENSE.txt`,
                source: await read(resolve(APP, path)),
            });
        }
    },
});
