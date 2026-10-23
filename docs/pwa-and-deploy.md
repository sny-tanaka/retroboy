# ホーム画面アプリ（PWA）と Netlify での配信

手順だけ知りたいときは README の「Netlify に公開する」を見る。ここには仕組みと、決めた理由を書く。

## 全体

- 配信先は Netlify の無料プラン。Project visibility を **Private** にして、チームオーナー（自分）が Netlify にログインしているときだけ見られるようにする。
- ビルドは手元で行い、できた `app/dist/` を netlify-cli で上げる（`npm run deploy`）。Netlify 側でビルドしないので、Rust・wasm-pack を Netlify に用意しなくてよく、GitHub のリポジトリへの権限も Netlify に渡さない。
- 配信するのはアプリ本体（HTML・JS・WASM・アイコン・manifest・Service Worker）だけ。ROM・ゲーム内セーブ・セーブステートは端末の中だけにあり、配信先には置かない（設計書 6 章）。

## ファイル

| ファイル | 内容 |
|---|---|
| `app/public/manifest.webmanifest` | Web App Manifest（名前・アイコン・standalone・縦向き・暗い色） |
| `app/public/icons/` | アイコンの PNG（`scripts/make-icons.sh` で作る。下の「アイコン」） |
| `app/index.html` | manifest・apple-touch-icon・iOS 用のメタ（ステータスバー・タイトル）・noindex |
| `app/sw/sw.template.js` | Service Worker の本体（このままでは配信しない） |
| `app/scripts/generate-sw.mjs` | `vite build` のあとに走り、`dist/` の一覧と版を付けて `dist/sw.js` を書く |
| `app/src/pwa/registerServiceWorker.ts` | Service Worker の登録（本番ビルドのときだけ） |
| `netlify.toml` | 公開するフォルダ（`app/dist`）とレスポンスヘッダー |

## Service Worker

手書きにした（vite-plugin-pwa などを使わない）。理由:

- やることが少ない（決まったファイルを先に全部キャッシュし、古い版を消すだけ）。vite-plugin-pwa は Workbox 一式を依存に足すことになり、中身を追いにくい。
- 「外へ通信しない」「ROM やセーブをキャッシュしない」をコードを読んで確かめられる大きさにしておきたい。

### キャッシュするもの

`npm run build`（と `npm run check`）の最後に `generate-sw.mjs` が `dist/` の中身を全部並べ、`dist/sw.js` の先頭に書き込む。

- 入れる: `dist/` のファイル全部（`index.html` は `./` として）。いまは JS・WASM・アイコン・manifest。
- 入れない: `sw.js` 自身、ソースマップ、Netlify の `_headers` / `_redirects`。
- `dist/` に `*.gb` / `*.gbc` / `*.rbs` / `*.sav` / `*.srm` があったらビルドを失敗させる。
- 走っている間に取ったものは足さない（キャッシュに入るのは上の一覧だけ）。

### 要求の扱い

- 同じオリジンの GET だけを扱う。外部の URL・`blob:`・`data:`・POST などには手を出さず、ブラウザに任せる（キャッシュもしない）。ROM・セーブは IndexedDB・localStorage・ファイル選択で扱い、URL で取りに行かないので、そもそも Service Worker を通らない。
- ページ（`index.html`）: まずネットワークに取りに行き、オフラインか 3 秒で返らなければキャッシュの `index.html` を出す。オンラインなら開くたびに最新の版になる。
- JS・WASM・アイコンなど: キャッシュにあればそれを、無ければネットワークから。名前にハッシュが付いているので、版が変われば別の名前になる。
- キャッシュとの照合は `ignoreVary: true` で行う。サーバーが `Vary: Origin` を返すと、`<script type="module">`（Origin 付きの要求）がキャッシュと一致せず、オフラインで起動できなくなったため（`vite preview` で起きた）。

### 新しい版を配ったとき

1. `generate-sw.mjs` が `dist/` の中身のハッシュを版（`VERSION`）にして `sw.js` に書くので、中身が変われば `sw.js` も変わる。
2. ブラウザはページを開くたび（と、ホーム画面アプリが前面に戻るたび）に `sw.js` を確かめる。`sw.js` は HTTP キャッシュを通さない（登録時の `updateViaCache: "none"` と `netlify.toml` の `Cache-Control: no-cache`）。
3. 変わっていれば新しい Service Worker が入り、新しい版のファイルを別のキャッシュ（`retroboy-snap-<版>`）に取る。待たずに入れ替わり（`skipWaiting`）、古い版のキャッシュ（`retroboy-snap-` で始まる別の名前）を消す。
4. 開いている画面は古い JS のまま動き続ける（途中で再読み込みはしない）。次に開いたときから新しい版になる。オンラインなら `index.html` はネットワークから取るので、たいていデプロイ直後の次の起動で新しい版になる。

ホーム画面アプリは閉じずに裏に回っているだけのことが多い。新しい版を確実に使いたいときは、アプリの切り替え画面で上にスワイプして閉じてから開き直す。

古いキャッシュがどうしても残ったときは、iPhone の「設定 > アプリ > Safari > 詳細 > Web サイトデータ」で消せるが、**ROM とゲーム内セーブも一緒に消える**ので最後の手段にする。

### 確かめ方（手元）

```sh
cd app
npm run build
npm run preview    # http://localhost:4173
```

開いたあと、開発者ツールの Application で manifest と Service Worker（`sw.js`、activated）とキャッシュ（`retroboy-snap-<版>`）が見える。`npm run preview` を止めてから再読み込みしても起動する。開発サーバー（`npm run dev`）では Service Worker を登録しない。

## アイコン

元画像は人間が作った 1254x1254 の PNG（紺の角丸四角の外側に白い余白がある）。iOS は角を自分で丸めるので、白い余白が見えないよう全面紺の正方形にした。

```sh
./scripts/make-icons.sh <元画像.png>   # ImageMagick 7（brew install imagemagick）が要る
```

1. 紺の角丸四角の外接正方形を、縁から 4px 内側で切り出す（1100x1100）。
2. 四隅に残る白（角丸の外側）を透明にし、透明な部分を 3px 内側へ広げて境目のにじみを消す。下に、四隅の近くの紺の色を 4 隅に置いたグラデーションを敷く。
3. 512・192・180（apple-touch-icon）に縮める。maskable（Android などが円で切り抜く）は絵を 72% に縮めて紺の余白をつける（縁はぼかしてつなぐ）。

出力は `app/public/icons/` で、git に入れる（元画像は入れていない）。

## Netlify のヘッダー（`netlify.toml`）

| 対象 | ヘッダー | 理由 |
|---|---|---|
| すべて | `X-Robots-Tag: noindex, nofollow` | 検索エンジンに載せない（`index.html` の robots メタと二重） |
| `/`・`/index.html`・`/sw.js`・`/manifest.webmanifest` | `Cache-Control: no-cache` | 新しい版がすぐ届くように |
| `/assets/*` | `Cache-Control: public, max-age=31536000, immutable` | Vite がハッシュ付きの名前で出すので長くキャッシュしてよい |
| `/assets/*.wasm` | `Content-Type: application/wasm` | `WebAssembly.instantiateStreaming` に要る |

画面は `/` の 1 枚だけでパスによる振り分けが無いので、SPA の書き換え（`/* → /index.html`）は置いていない。
