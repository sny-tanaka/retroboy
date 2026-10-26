# ホーム画面アプリ（PWA）と GitHub Pages での配信

手順だけ知りたいときは README の「GitHub Pages に公開する」を見る。ここには仕組みと、決めた理由を書く。

## 全体

- 配信先は GitHub Pages（https://sny-tanaka.github.io/retroboy-snap/）。リポジトリは public で、配信物も誰でも見られる。前は Netlify の Private で配っていたが、無料プランのクレジットが足りなくなるので移した。
- ビルドは手元で行い、できた `app/dist/` の中身だけを 1 コミットにして `gh-pages` ブランチに強制で push する（`npm run deploy` → `scripts/deploy-pages.sh`）。Pages は「ブランチから配信」で `gh-pages` の `/` を配る。GitHub Actions で Rust・wasm-pack・GBDK を用意しなくてよい。
- サブパス（`/retroboy-snap/`）の下で配るので、アプリは自分の置き場所からの相対パスですべてを参照する（下の「サブパス」）。
- 配信するのはアプリ本体（HTML・JS・WASM・アイコン・manifest・Service Worker）と内蔵ソフト（`games/` の自作ゲームの ROM と目録。`docs/builtin-games.md`）だけ。利用者が追加した ROM・ゲーム内セーブ・セーブステートは端末の中だけにあり、配信先には置かない（設計書 6 章）。

## ファイル

| ファイル | 内容 |
|---|---|
| `app/public/manifest.webmanifest` | Web App Manifest（名前・アイコン・standalone・縦向き・暗い色） |
| `app/public/icons/` | アイコンの PNG（`scripts/make-icons.sh` で作る。下の「アイコン」） |
| `app/index.html` | manifest・apple-touch-icon・iOS 用のメタ（ステータスバー・タイトル）・noindex |
| `app/public/.nojekyll` | GitHub Pages に Jekyll を通させない（`dist/` にそのまま写る） |
| `app/sw/sw.template.js` | Service Worker の本体（このままでは配信しない） |
| `app/scripts/generate-sw.mjs` | `vite build` のあとに走り、`dist/` の一覧と版を付けて `dist/sw.js` を書く |
| `app/src/pwa/registerServiceWorker.ts` | Service Worker の登録（本番ビルドのときだけ）と、新しい版が届いたことの検知 |
| `app/vite.config.ts` | `base: "./"`。アプリの版（画面に出すもの）とビルドの印を JS に埋め込み、`dist/version.json` にも書く |
| `app/plugins/licenseFiles.ts` | `dist/` にライセンスの文書を入れる（下の「ライセンスの文書」） |
| `scripts/deploy-pages.sh` | `npm run check` → `dist/` を `gh-pages` に 1 コミットで push → 公開の `version.json` を確かめる |

## Service Worker

手書きにした（vite-plugin-pwa などを使わない）。理由:

- やることが少ない（決まったファイルを先に全部キャッシュし、古い版を消すだけ）。vite-plugin-pwa は Workbox 一式を依存に足すことになり、中身を追いにくい。
- 「外へ通信しない」「ROM やセーブをキャッシュしない」をコードを読んで確かめられる大きさにしておきたい。

### キャッシュするもの

`npm run build`（と `npm run check`）の最後に `generate-sw.mjs` が `dist/` の中身を全部並べ、`dist/sw.js` の先頭に書き込む。

- 入れる: `dist/` のファイル全部（`index.html` は `./` として）。いまは JS・WASM・アイコン・manifest。
- 入れない: `sw.js` 自身、ソースマップ、`.nojekyll`。ライセンスの文書（`LICENSE.txt` など）は入る（小さいので、オフラインでも読める）。
- `dist/` に `*.gb` / `*.gbc` / `*.rbs` / `*.sav` / `*.srm` があったらビルドを失敗させる。例外は内蔵ソフトの ROM だけで、`dist/builtin/index.json` の目録に載っていて、中身の SHA-256 と大きさが目録と合う `dist/builtin/` の ROM は通して事前キャッシュに入れる（オフラインでも内蔵ソフトを選べる）。
- 走っている間に取ったものは足さない（キャッシュに入るのは上の一覧だけ）。

### 要求の扱い

- 同じオリジンの GET だけを扱う。外部の URL・`blob:`・`data:`・POST などには手を出さず、ブラウザに任せる（キャッシュもしない）。利用者の ROM・セーブは IndexedDB・localStorage・ファイル選択で扱い、URL で取りに行かないので、そもそも Service Worker を通らない（内蔵ソフトの ROM だけは `builtin/` から取り、事前キャッシュから出る）。
- ページ（`index.html`）: まずネットワークに取りに行き、オフラインか 3 秒で返らなければキャッシュの `index.html` を出す。オンラインなら開くたびに最新の版になる。ネットワークへは `cache: "no-cache"` で取りに行き、ブラウザの HTTP キャッシュにあっても必ずサーバーに確かめる（下の「GitHub Pages のヘッダー」）。
- JS・WASM・アイコンなど: キャッシュにあればそれを、無ければネットワークから。名前にハッシュが付いているので、版が変われば別の名前になる。
- キャッシュとの照合は `ignoreVary: true` で行う。サーバーが `Vary: Origin` を返すと、`<script type="module">`（Origin 付きの要求）がキャッシュと一致せず、オフラインで起動できなくなったため（`vite preview` で起きた）。

### 新しい版を配ったとき

1. `generate-sw.mjs` が `dist/` の中身のハッシュを版（`VERSION`）にして `sw.js` に書くので、中身が変われば `sw.js` も変わる。
2. ブラウザはページを開くたび（と、ホーム画面アプリが前面に戻るたび）に `sw.js` を確かめる。`sw.js` は HTTP キャッシュを通さない（登録時の `updateViaCache: "none"`。Pages の `max-age=600` は効かない）。
3. 変わっていれば新しい Service Worker が入り、新しい版のファイルを別のキャッシュ（`retroboy-snap-<版>`）に取る。待たずに入れ替わり（`skipWaiting`）、古い版のキャッシュ（`retroboy-snap-` で始まる別の名前）を消す。
4. 開いている画面は古い JS のまま動き続ける（勝手に再読み込みはしない）。次に開いたときから新しい版になる。オンラインなら `index.html` はネットワークから取るので、たいていデプロイ直後の次の起動で新しい版になる。
5. 開いている画面には、ゲーム画面の下に「新しい版があります」と「再読み込み」「あとで」を出す（メニューの「このアプリ」にも「新しい版に切り替える（再読み込み）」が出る）。「再読み込み」を押すと、待っているゲーム内セーブを書き出してから `location.reload()` する。

#### 新しい版が届いたことの見分け方

`app/src/pwa/registerServiceWorker.ts`。

- `sw.js` は入るとすぐ入れ替わる（`skipWaiting` と `clients.claim`）ので、画面では `controllerchange`（受け持ちの Service Worker が替わった）を合図にする。
- 入れ替わっただけでは知らせない。初めて Service Worker が入ったときや、デプロイのあとに開いた画面（ネットワークから新しい版を読み込んだのに、受け持ちはまだ古い Service Worker）でも入れ替わるため。新しい受け持ちのキャッシュにある `version.json` のビルドの印（`buildId`）を読み、画面に埋め込まれた印と違うときだけ知らせる。
- 開いたときには確かめない（デプロイ直後は、画面は新しいのに古い Service Worker のキャッシュの `version.json` が古く、違って見えるため）。

#### 版の文字列

| もの | 中身 | 使い道 |
|---|---|---|
| アプリの版（`__APP_VERSION__`、`version.json` の `version`） | ビルドした日時（日本時間・分まで）と git の短いコミットハッシュ。コミットしていない変更（追跡していないファイルも含む）があれば `+`。例: `2026-10-24 12:34 (abc1234)` | メニューの一番下に出し、人が更新できたかを確かめる |
| ビルドの印（`__BUILD_ID__`、`version.json` の `buildId`） | ビルドした時刻（ミリ秒まで、ISO 8601） | 新しい版が届いたかの判定（表示の版は分単位で、同じ分のビルドを見分けられないため） |
| Service Worker の版（`sw.js` の `VERSION`） | `dist/` の中身のハッシュ | キャッシュの名前。中身が変われば新しい Service Worker が入る |

ホーム画面アプリは閉じずに裏に回っているだけのことが多い。前面に戻したときに `sw.js` を確かめるので、新しい版があればお知らせが出る。出ないのに新しい版を使いたいときは、アプリの切り替え画面で上にスワイプして閉じてから開き直す。

古いキャッシュがどうしても残ったときは、iPhone の「設定 > アプリ > Safari > 詳細 > Web サイトデータ」で消せるが、**ROM とゲーム内セーブも一緒に消える**ので最後の手段にする。

### 確かめ方（手元）

```sh
cd app
npm run build
npm run preview    # http://localhost:4173（base が ./ なので / でもそのまま動く）
```

本番ビルドは音が鳴るので、手元で確かめるときは `http://localhost:4173/?mute=1` のように `?mute=1` を付けて開く（無音になるだけで、ゲームの進みは変わらない）。開発サーバー（`npm run dev`）は何も付けなくても無音（鳴らすときは `?sound=1`）。

開いたあと、開発者ツールの Application で manifest と Service Worker（`sw.js`、activated）とキャッシュ（`retroboy-snap-<版>`）が見える。`npm run preview` を止めてから再読み込みしても起動する。開発サーバー（`npm run dev`）では Service Worker を登録しない。

更新のお知らせは、開いたまま `npm run build` をやり直し、タブを裏に回して戻す（`visibilitychange`）と出る。

## アイコン

元画像は人間が作った 1254x1254 の PNG（紺の角丸四角の外側に白い余白がある）。iOS は角を自分で丸めるので、白い余白が見えないよう全面紺の正方形にした。

```sh
./scripts/make-icons.sh <元画像.png>   # ImageMagick 7（brew install imagemagick）が要る
```

1. 紺の角丸四角の外接正方形を、縁から 4px 内側で切り出す（1100x1100）。
2. 四隅に残る白（角丸の外側）を透明にし、透明な部分を 3px 内側へ広げて境目のにじみを消す。下に、四隅の近くの紺の色を 4 隅に置いたグラデーションを敷く。
3. 512・192・180（apple-touch-icon）に縮める。maskable（Android などが円で切り抜く）は絵を 72% に縮めて紺の余白をつける（縁はぼかしてつなぐ）。

出力は `app/public/icons/` で、git に入れる（元画像は入れていない）。

## サブパス

Pages では https://sny-tanaka.github.io/retroboy-snap/ のように `/retroboy-snap/` の下で配る。`/` を前提にしたところが無いようにしている。

| ところ | 書き方 |
|---|---|
| `vite.config.ts` | `base: "./"`。`index.html` の JS・CSS・manifest・アイコン、JS の中の WASM はすべて `./` からの相対になる（サブパスでも `/` でも動く）。開発サーバーでは `/` として扱われる |
| `index.html` | manifest と apple-touch-icon は `/manifest.webmanifest` のように書く。ビルドで vite が `./` に書き換える |
| `manifest.webmanifest` | `id`・`start_url`・`scope` は `./`、アイコンは `icons/…`。manifest の URL からの相対なので `/retroboy-snap/` になる |
| `registerServiceWorker.ts` | `sw.js` と `version.json` は `import.meta.env.BASE_URL`（ビルドでは `./`）から。スコープは `sw.js` の置き場所（`/retroboy-snap/`） |
| `sw.template.js` | 事前キャッシュの一覧（`PRECACHE`）は相対パスで、スコープからの URL にして取る。`index.html` はスコープそのもの（`./`）をキーにする |
| 内蔵ソフト | `builtin/…` を `BASE_URL` から取る（`app/src/storage/builtinGames.ts`） |

サブパスで動くかは、`dist/` を一時ディレクトリの `retroboy-snap/` に写してその親を配るサーバーで確かめる（Playwright で、起動・内蔵ソフト・Service Worker・更新のお知らせ・オフラインでの再読み込み）。

## GitHub Pages のヘッダー

Pages ではレスポンスヘッダーを変えられない（Netlify のときの `netlify.toml` は消した）。既定でこうなる:

| 対象 | Pages の既定 | 困らないか |
|---|---|---|
| すべて | `Cache-Control: max-age=600` と `ETag` | 下を見る |
| `*.wasm` | `Content-Type: application/wasm`（のはず。初回の公開で curl で確かめる） | `WebAssembly.instantiateStreaming` に要る。違っても、つなぎのコードは `arrayBuffer` で読み直す |
| `*.webmanifest` | `application/manifest+json`（のはず） | 違っても Safari・Chrome は読む |
| `X-Robots-Tag`・`Referrer-Policy` など | 付けられない | `index.html` の robots メタで noindex を伝える |

`max-age=600` で困るところと手当て:

- `sw.js`: 登録時の `updateViaCache: "none"` で、更新の確かめは HTTP キャッシュを通らない。デプロイのあと、開いたとき・前面に戻したときに新しい `sw.js` が入り、「新しい版があります」が出る。
- 新しい Service Worker の事前キャッシュ: `cache: "reload"` で取るので、HTTP キャッシュの古いファイルを拾わない。
- `index.html`: Service Worker が受け持っているときは `cache: "no-cache"` で取る（ETag で確かめ、変わっていなければ 304）。こうしないと、デプロイ後 10 分ほどはブラウザの HTTP キャッシュの古い `index.html` が出て、もう配信していない古い JS を取りに行くことがある（手元のサーバーで、付けないと古い版のまま開くことを確かめた）。Service Worker がまだ無い最初の 1 回だけは、ブラウザの HTTP キャッシュに従う。
- `assets/` の JS・CSS・WASM は名前にハッシュが付くので、古いものがキャッシュに残っても困らない。

## ライセンスの文書

`app/plugins/licenseFiles.ts` が本番ビルドで `dist/` に入れる。何がどこから来たかは `NOTICE` に書いている。

| `dist/` のファイル | 元 |
|---|---|
| `LICENSE.txt`・`NOTICE.txt` | このリポジトリの `LICENSE`（Apache-2.0）・`NOTICE` |
| `licenses/retroboy-LICENSE.txt` | `core/upstream/LICENSE`（コアの Retro Boy、Apache-2.0） |
| `licenses/misaki-font.txt` | `games/tamers-life/assets/font/misaki/misaki.txt`（美咲フォント） |
| `licenses/react-LICENSE.txt` など | `app/node_modules/<パッケージ>/LICENSE`（JS のバンドルに入る npm のパッケージ） |
| そのほかの `licenses/*.txt` | リポジトリの `licenses/`（ブート ROM の Bootix・SameBoy、WASM に入る Rust のクレートと標準ライブラリ、npm の配布物に LICENSE が無い qrcode-generator） |

Vite のバンドルは依存の著作権表示を残さない。そのため、バンドルに入った npm のパッケージがプラグインの `NPM_LICENSES` に無ければ、ビルドを止める。依存を足したら、`NPM_LICENSES` と `NOTICE` にも足す。Rust のクレートを足したときは、止まらないので自分で `licenses/` と `NOTICE` に足す（`cargo tree --manifest-path core/Cargo.toml --target wasm32-unknown-unknown -e normal` で、WASM に入るもの〔proc-macro でないもの〕を見る）。
