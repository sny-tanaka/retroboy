# retroboy-snap

[Retro Boy](https://github.com/smparsons/retroboy) のエミュレーターコアを使った、iPhone のホーム画面で遊ぶための個人用 Game Boy エミュレーター。

- `core/` … 本家 Retro Boy のコアを取り込むだけの Rust クレート。これを WASM にビルドして使う。本家は `core/upstream.rev` のコミットを `core/upstream/`（git に入れない）に取ってきて、`core/patches/` のパッチを当て、path 依存で使う（下の「本家のコードに手を入れる」）。
  - `core/patches/` … 本家への変更。いまは通信ケーブルのためのもの（serial の速さの直し・通信の口・WASM の API）。設計は `docs/link-cable-design.md`。
  - `core/tests/link.rs` … 通信テスト ROM で 2 台のエミュレーターを直結する試験。
- `app/` … Vite + React + TypeScript のアプリ。本家 `frontends/web` から移したつなぎのコードは `app/src/emulator/`。
  - `app/src/link/` … 通信ケーブル。送り合うメッセージ（`protocol.ts`）、道（`transport.ts`）、2 台の進みを合わせる部分（`linkSession.ts`）、いまのつながり（`linkStore.ts`）、WebRTC の道（`webrtcTransport.ts`）と接続情報のコード（`signal.ts`）、QR（`qr.ts`）。つなぐ画面は `app/src/ui/LinkConnect.tsx`。下の「通信ケーブル」。
  - `app/src/storage/` … ROM を端末内（IndexedDB）に保存する処理と、保存領域の永続化（`navigator.storage.persist()`）。
  - `app/src/session/useRomSession.ts` … 画面の状態とロジック（ROM の追加・自動読み込み・起動・停止）。`App.tsx` は見た目だけ。
  - `app/public/` … Web App Manifest とアイコン。`app/sw/sw.template.js` が Service Worker の本体で、`app/scripts/generate-sw.mjs` がビルド後に `dist/sw.js` を作る。
  - `app/src/ui/` … ゲームボーイカラー風の本体の部品（画面枠・ぷにコン・A/B・SELECT/START・メニュー・片手操作の `OneHandCluster`（片手 A）と `GestureControls`（片手 B））。`npm run dev` で `/preview.html` を開くと、エミュレーターに繋がずに見た目と押した反応を確かめられる（`?layout=twohand|onehand-a|onehand-b` で操作を選んで開く、`?reach=1` で右手の親指の届く範囲の目安を重ねる）。
- `mgba/` … GBA のコア。本家 [mGBA](https://github.com/mgba-emu/mgba)（MPL-2.0）を `mgba/upstream.rev`（0.10.5）のコミットで `mgba/upstream/`（git に入れない）に取ってきて、`mgba/patches/` のパッチ（Emscripten ではスレッドなしで作る）を当てる。`mgba/glue/mgba-glue.c` は JS から呼ぶ口。下の「GBA（試し）」。
  - `app/src/gba/` … GBA のコアの TS の口（`gbaCore.ts`）、いま動いている GBA のゲーム（`gbaSession.ts`。ボタン・ゲーム内セーブ）、音の予約の時刻で進めるループ（`useGbaLoop.ts`）。
- `scripts/build-mgba.sh` … mGBA を WASM にビルドして `app/src/gba/core/` に出力する（生成物は git に入れない。Emscripten は emsdk 5.0.7）。
- `scripts/build-wasm.sh` … コアを WASM にビルドして `app/src/core/` に出力する（生成物は git に入れない）。最初に `scripts/prepare-core.sh` で本家を用意してパッチを当てる。
- `scripts/prepare-core.sh` / `scripts/export-core-patches.sh` … 本家の用意とパッチ当て／`core/upstream/` の変更をパッチに書き出す。引数に `mgba` を付けると mGBA（`mgba/`）で同じことをする。
- `scripts/test-core.sh` … コアの試験（本家の単体試験と `core/tests/`）。
- `games/` … アプリに内蔵して配信する自作ゲーム（ゲームごとに `games/<id>/` にソース・ビルドの仕方・`game.json`〔表示名・説明・GB/GBC・ROM の場所〕・できた ROM）。通信テスト（`games/linktest/`。ROM は `testroms/link/`）・テイマーズライフ（`games/tamers-life-gba/`。GBA）・GBA の重さを測るデモ（`games/gba-bench/`）。テイマーズライフはソースを非公開の別のリポジトリ（tamers-life）で作り、ここには、できた ROM と攻略サイト（`guide/`。`/guide/` で配信する）だけを置く（`games/tamers-life-gba/README.md`）。決まりと仕組みは `docs/builtin-games.md`。
  - `app/plugins/builtinGames.ts` … ビルドのときに `games/` を読み、内蔵ソフトの目録をアプリに入れ、ROM と目録を `app/dist/builtin/` に、攻略サイト（game.json の `guide`）を `app/dist/<guide>` に出す vite のプラグイン。
- `scripts/build-games.sh` … `games/` のゲームのうち Makefile があるものをビルドする（GBDK-2020 など。`--check` でコミットしてある ROM と合っているかを確かめる）。
- `testroms/` … 自作のテスト ROM（RGBDS のソースと、できた ROM）。いまは通信ケーブルのテスト ROM（`testroms/link/link.asm` と `linktest.gb`）。
- `scripts/make-icons.sh` … アイコンの元画像から `app/public/icons/` の PNG を作る。
- `licenses/` … 配信物に入れる第三者のライセンスの全文のうち、取ってきたコアや node_modules に無いもの（ビルドで `app/dist/licenses/` に写る。一覧は `NOTICE`）。
- `scripts/deploy-pages.sh` … `app/dist/` を GitHub Pages（`gh-pages` ブランチ）に出す（`npm run deploy`）。
- `docs/pwa-and-deploy.md` … ホーム画面アプリ（PWA）・Service Worker・GitHub Pages での配信の仕組みと、アイコンの作り方。
- `docs/upstream-notes.md` … 本家のセーブ RAM・セーブステート・WASM API の調査メモと、このアプリでの変更点。
- `docs/future-work.md` … 今後の課題（ゲーム内セーブのバックアップなど）。
- `docs/link-cable-design.md` … 通信ケーブル（同じ Wi-Fi の 2 台での交換・対戦）の設計。
- `docs/builtin-games.md` … 内蔵ソフト（自作ゲームをアプリに入れて配る）の決まり・ビルド・セーブの扱い。

市販のゲームの ROM はリポジトリにもビルド成果物にも入れない（著作権の問題があるため。`.gitignore` で `*.gb` / `*.gbc` を除き、`app/dist` に ROM が入るとビルドが止まる）。例外は自作の ROM だけ:

- `testroms/` の自作のテスト ROM はリポジトリに入れる。
- `games/` の自作ゲームの ROM はリポジトリに入れ、アプリに内蔵して配信する（「内蔵ソフト」）。`app/dist` で通すのは `app/dist/builtin/index.json` の目録に載っていて中身の SHA-256 が合う `app/dist/builtin/` の ROM だけで、それ以外の ROM が入ればこれまで通りビルドが止まる（`docs/builtin-games.md`）。

## 使い方

画面はゲームボーイカラー風の本体で、iPhone の縦持ちで使う。

1. 初回はゲーム画面の中の「内蔵ソフトから選ぶ」でアプリに入っている自作のソフトを選ぶか、「ROM を追加」で ROM ファイル（`.gb` / `.gbc` / `.gba`）を選ぶ。追加した ROM は端末内（IndexedDB）に保存され、そのまま始まる。内蔵ソフトはファイルを用意しなくても遊べ、オフラインでも選べる（削除はできない）。
2. 次からは開くと前回の ROM が読み込まれるので、ゲーム画面の「タップして開始」を押す（iPhone は音を鳴らすのにタップが要るため）。
3. ほかのソフトは「メニュー」の「内蔵ソフト」「追加した ROM」の一覧で選ぶか、「＋ ROM を追加」で足す。遊んでいる途中でも切り替えられる。

操作は「メニュー」の「操作」で、両手・片手 A・片手 B から選ぶ（既定は両手）。選んだものは端末に覚え、次の起動でも使う。遊んでいる途中で切り替えてもよい（切り替えると押していたボタンは全部離す）。画面の上の「メニュー」から「ロード」までと、キーボードの操作はどれでも同じ。

両手（いまの配置）:

| 部品 | 内容 |
|---|---|
| 左下のぷにコン | 方向（8 方向）。左側のどこを触っても触った所が中心になり、指をずらした向きが入る。指を離さずに回して方向を変えられる |
| A / B・SELECT / START | そのままのボタン。B と A の間を押すと両方が入る |

片手 A（寄せ配置。右手で持ち、親指で操作する）:

| 部品 | 内容 |
|---|---|
| ぷにコン | 下半分の、ボタンの外のどこを触っても、触った所が中心の小さめのぷにコンになる（判定は両手と同じで、少し小さい） |
| A / B | 右下の弧に並ぶ。B と A の間を押すと両方が入り、B から A へ滑らせられる |
| SELECT / START | 右下の一番下の段に、水平に並ぶ小さなボタン |

片手 B（ジェスチャー。右手で持ち、親指で操作する）:

| 操作 | 内容 |
|---|---|
| なぞる | 方向。触った所から 10px より動かすとなぞる扱いになり、判定はぷにコンと同じ。中心は触った所のまま、指を離すまで動かない（遠くまでなぞっても指についてこない） |
| タップ | A。動かさずに 0.28 秒より前に離すと、離したときに A を 0.09 秒押す |
| 長押し | B。動かさずに 0.28 秒触り続けると B が入り、離すまで押したまま |
| もう 1 本の指 | B。1 本目の指を触っている間に別の指で触ると、その指を離すまで B（なぞりながら B も入れられる） |
| 右下の SELECT / START | そのままのボタン |

画面の上の操作（どの操作の配置でも同じ）:

| 部品 | 内容 |
|---|---|
| 画面の下の「メニュー」 | 一時停止と再開、通信ケーブル（つなぐ・切る）、内蔵ソフトと追加した ROM の一覧と切り替え・追加、操作の配置、セーブステートのファイルの書き出しと読み込み、保存の状態（永続化・使用量）、アプリのバージョン |
| 倍速（「▶▶ ×1」） | 押すたびに ×1 → ×1.5 → ×2 → ×1 と速さが変わり、いまの速さが出る。倍速の間は、音は高さを変えずにテンポだけ速くなる。速さは覚えない（起動したとき・ROM を始めたときは ×1）。端末が追いつかないときは、その分だけ遅くなる |
| 「セーブ」 | いまの状態（セーブステート）とそのときのゲーム画面を端末内にすぐ保存し、「セーブしました」を一瞬出す。枠は ROM ごとに 1 つで、押すたびに上書きする。ゲームは止まらない |
| 「ロード」 | 確認のあと、その ROM の端末内のセーブに戻す（いまの進みは上書きされる）。確認には、セーブした日時と、セーブしたときのゲーム画面を出す（画面を残すようにする前のセーブは日時だけ）。まだセーブしていない ROM では押せない |

セーブステートの `.rbs` ファイルへの書き出しと、ファイルからの読み込みは「メニュー」の「セーブステート（ファイル）」で行う（端末内のセーブとは別。読み込んでも端末内のセーブは変わらない）。

一時停止は「メニュー」の一番上の「一時停止」で行い、押すとメニューが閉じて止まったままになる。再開は、ゲーム画面の「一時停止中（タップで再開）」を押すか、メニューの「再開」。メニュー・確認・ファイル選択を開いている間はゲームが止まり、閉じると元に戻る。キーボードでも操作できる（下の「キーボードでの操作」）。

端末に保存されるもの（外へは送らない）:

| もの | 場所 |
|---|---|
| 追加した ROM 本体と名前（ID は中身の SHA-256）、前回の ROM（内蔵ソフトなら `builtin:<id>`） | IndexedDB `retroboy-snap` の `roms` / `settings` |
| 内蔵ソフトの ROM（アプリと一緒に配られる。IndexedDB には入れない） | Service Worker のキャッシュ（`builtin/`） |
| 内蔵ソフトの、前に遊んだ版（版が上がったときにゲーム内セーブを引き継ぐのに使う） | localStorage `builtinSave:<内蔵ソフトの id>` |
| 「セーブ」で保存したセーブステートと、そのときのゲーム画面（160x144 の PNG）。ROM ごとに 1 つ | IndexedDB `retroboy-snap` の `saveStates`（キーは ROM の ID） |
| ゲーム内セーブ（セーブ RAM・RTC）。ROM ごとに分かれる | localStorage `sram:<ROM の ID>` / `rtc:<ROM の ID>` |
| 操作の配置（両手・片手 A・片手 B） | localStorage `controlLayout` |

内蔵ソフトの ID も中身の SHA-256 なので、セーブは版ごとに分かれる。版が上がったときは、前の版のゲーム内セーブだけを新しい版に写す。起動時に、いまの版と 1 つ前の版（と形式ごとの最新の版）を残して、それより古い版のゲーム内セーブを消す。1 つ前の版は、新しい版で続きから遊べると確かめてから、メニューの「古い版のセーブを消す」で消す（セーブステートは写さず、古い版の枠は次に起動したときに消す。消すのは内蔵ソフトの過去の版と分かっている ID だけで、利用者が追加した ROM のセーブは消さない。`docs/builtin-games.md`）。

ゲーム内セーブは 10 秒ごとにまとめて書き（変化が無ければ書かない）、画面を離れるとき（ホームに戻す・閉じる）にはすぐ書く。サイトデータの削除などで消えるので、バックアップは今後の課題（`docs/future-work.md`）。

ROM の ID の計算（`crypto.subtle`）は HTTPS か `localhost` でしか動かない。iPhone から開発サーバーに `http://<PC の IP>` でつなぐと ROM を追加できない。

## 必要なツール

- Node.js 22 以上（npm）
- rustup で入れた Rust と `wasm32-unknown-unknown` ターゲット
- wasm-pack
- RGBDS（テスト ROM のビルド。テスト ROM はリポジトリに入っているので、ソースを直すときだけ要る。入っていれば `npm run check` がソースと ROM が合っているかも確かめる）
- GBDK-2020 **4.5.0**（GBDK で作る自作ゲームのビルド。いまは GBDK のゲームは無い。版が違うとできる ROM が変わり `--check` が止まるので、版をそろえる）
- emsdk **5.0.7**（Emscripten。GBA のコアの mGBA を WASM にする `scripts/build-mgba.sh`。`npm run check` が使うので要る）と cmake・ninja
- LLVM（Homebrew の `llvm` と `lld`。GBA のデモ `games/gba-bench/` と GBA 通信テスト `games/linktest-gba/` のビルド。ROM はリポジトリに入っているので、ソースを直すときだけ要る。版は `games/gba-bench/README.md`）

macOS（Homebrew）の例:

```sh
brew install rustup wasm-pack rgbds
# rustup は keg-only なので PATH に入らない。scripts/build-wasm.sh は自動で rustup 側を優先する
"$(brew --prefix rustup)/bin/rustup" default stable
"$(brew --prefix rustup)/bin/rustup" target add wasm32-unknown-unknown
```

emsdk は `~/.local/emsdk` に入れる（別の場所なら環境変数 `EMSDK` で指す。`scripts/build-mgba.sh` は版が 5.0.7 でないと止まる）:

```sh
brew install cmake ninja llvm lld
git clone --branch 5.0.7 --depth 1 https://github.com/emscripten-core/emsdk.git ~/.local/emsdk
~/.local/emsdk/emsdk install 5.0.7
~/.local/emsdk/emsdk activate 5.0.7    # シェルの設定（emsdk_env.sh）は要らない。build-mgba.sh が直に emcc を使う
```

GBDK-2020 は Homebrew に無いので、[GitHub Releases の 4.5.0](https://github.com/gbdk-2020/gbdk-2020/releases/tag/4.5.0) から macOS 用の tar.gz（Apple Silicon なら `gbdk-macos-arm64.tar.gz`、Intel なら `gbdk-macos.tar.gz`）を落として `~/.local/gbdk` に展開する（別の場所なら環境変数 `GBDK_HOME` で指す）:

```sh
gh release download 4.5.0 -R gbdk-2020/gbdk-2020 -p gbdk-macos-arm64.tar.gz -D ~/Downloads
shasum -a 256 ~/Downloads/gbdk-macos-arm64.tar.gz
# 289ee60e46c5a2785a21e35533f84a5131ed4a063b21b0dbdedc9a10af15bf78 （2026-10-26 に落としたもの）
mkdir -p ~/.local
tar -xzf ~/Downloads/gbdk-macos-arm64.tar.gz -C ~/.local   # ~/.local/gbdk ができる
xattr -dr com.apple.quarantine ~/.local/gbdk               # macOS に止められないように
~/.local/gbdk/bin/lcc -v
```

版を上げるときは、全部のゲームを `./scripts/build-games.sh` で作り直して ROM もコミットし、ここの版と SHA-256 を書き換える。

Homebrew の `rust` が入っていても消す必要はない（`rust` には wasm32 ターゲットが無いので、ビルドには rustup 側の cargo を使う）。

## 開発手順

```sh
# 1. コアを WASM にビルド（app/src/core/ に出力。本家の版やパッチを変えたら再実行）
#    初回は本家のソースを GitHub から core/upstream/ に取ってくる
./scripts/build-wasm.sh
#    GBA のコア（mGBA）も（app/src/gba/core/ に出力。初回は mgba/upstream/ に取ってきて 1 分ほどかかる）
./scripts/build-mgba.sh

# 2. アプリの依存を入れて起動
cd app
npm ci
npm run dev        # http://localhost:5173
```

開発サーバーは無音で動く（ゲームの進みは鳴らすときと同じ）。音を聞きたいときは URL に `?sound=1` を付ける。本番ビルドを手元で確かめるとき（`npm run preview` や Playwright）は、URL に `?mute=1` を付けると無音になる（付けなければ本番と同じく鳴る）。ブラウザでアプリを開く試験用のスクリプト（`scripts/link-e2e.mjs`）は `?mute=1` を付けて開く。仕組みは `app/src/emulator/audioOutput.ts`。

## まとめて検査する

CI は置いていない。PR を出す前に手元で次を流す:

```sh
cd app
npm run check
```

WASM のビルド（Retro Boy と mGBA）→ コアの試験（テスト ROM のビルドを含む）→ 自作ゲームの ROM がソースと合っているか（`scripts/build-games.sh --check`）→ 型チェック → lint → 本番ビルドを順に実行し、どれかが失敗したらそこで止まる。

その他のコマンド（`app/` で実行）:

| コマンド | 内容 |
|---|---|
| `npm run check` | WASM のビルド・コアの試験・型チェック・lint・本番ビルドをまとめて実行 |
| `npm run build:games` | `games/` の自作ゲームの ROM をビルドする（`../scripts/build-games.sh`。`npm run build:games -- <id>` で 1 つだけ） |
| `npm run test:core` | コアの試験（`../scripts/test-core.sh`。本家の単体試験と、通信テスト ROM で 2 台を直結する試験） |
| `npm run typecheck` | 型チェック |
| `npm run lint` | ESLint |
| `npm run build` | 型チェックして `app/dist/` に本番ビルド |
| `npm run preview` | 本番ビルドをローカルで配信（Service Worker も動く。音を出さずに確かめるときは URL に `?mute=1`） |
| `npm run deploy` | `npm run check` を通してから GitHub Pages に出す（下の「GitHub Pages に公開する」。`-- --dry-run` で push しない） |
| `npm run build:wasm` | `../scripts/build-wasm.sh` と同じ |
| `npm run build:mgba` | `../scripts/build-mgba.sh` と同じ（GBA のコア） |

キーボードでの操作: 方向 = 矢印キー / A = Z / B = X / START = Enter / SELECT = Space / L = A / R = S（L・R は GBA だけ）

## GitHub Pages に公開する

GitHub Pages で https://sny-tanaka.github.io/retroboy-snap/ に配信する（リポジトリは public）。ビルドは手元で行い、`app/dist/` の中身だけを 1 コミットにして `gh-pages` ブランチに強制で push する（GitHub Actions は使わない）。仕組みは `docs/pwa-and-deploy.md`。

配信物は誰でも見られる。入るのはアプリ本体・内蔵の自作ソフト・ライセンスの文書だけで、市販の ROM は入らない（`app/dist` に ROM が入るとビルドが止まる）。検索エンジンには `index.html` の `<meta name="robots" content="noindex, nofollow">` で載せないように伝える（Pages ではヘッダーを付けられない）。

### 初回だけ

1. GitHub のリポジトリの **Settings > General > Danger Zone > Change repository visibility** で public にする（無料プランで Pages を使うため）。
2. 一度 `npm run deploy` して `gh-pages` ブランチを作る（下の「毎回」）。
3. **Settings > Pages > Build and deployment** で Source を **Deploy from a branch**、Branch を **gh-pages** と **/ (root)** にして保存する。

### 毎回

```sh
cd app
npm run deploy     # npm run check → app/dist を gh-pages に 1 コミットで push → 公開の version.json が新しい版になるまで待つ
```

`scripts/deploy-pages.sh` がすること:

1. `npm run check`（WASM のビルド・コアの試験・型チェック・lint・本番ビルド・Service Worker の生成と ROM の検査）。
2. `app/dist/` を一時ディレクトリに写し、そこで新しい git リポジトリを作って 1 コミットにする（作業中のブランチや作業ツリーには触らない）。作者は `sny-tanaka <36751082+sny-tanaka@users.noreply.github.com>`。
3. `origin` の `gh-pages` に強制で push する（前の版は残さない）。
4. https://sny-tanaka.github.io/retroboy-snap/version.json を 15 秒おきに取り、いま出した版の `buildId` になったら終わる（10 分で見切る）。

push せずに中身だけ見たいときは `npm run deploy -- --dry-run`（コミットを作った一時ディレクトリの場所を出す）。

出したあと手で確かめるとき:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://sny-tanaka.github.io/retroboy-snap/version.json   # 200
curl -sS https://sny-tanaka.github.io/retroboy-snap/version.json                                     # 出した版
curl -sSI https://sny-tanaka.github.io/retroboy-snap/ | grep -i content-type                        # text/html
curl -sSI "https://sny-tanaka.github.io/retroboy-snap/$(curl -sS https://sny-tanaka.github.io/retroboy-snap/sw.js | grep -o 'assets/[^"]*\.wasm')" | grep -i content-type   # application/wasm
```

### iPhone のホーム画面に入れる

1. iPhone の Safari で https://sny-tanaka.github.io/retroboy-snap/ を開く。
2. 共有ボタン →「ホーム画面に追加」。
3. ホーム画面のアイコンから開く。ホーム画面アプリは Safari と保存領域が別のことがあるので、ROM の追加とセーブの確かめはホーム画面アプリの中で行う（設計書 Step 7）。

一度開けば、オフラインでも起動する（アプリ本体を Service Worker がキャッシュする）。新しい版を上げたあとは、オンラインで開き直すと新しい版になる。開いたまま（裏に回していたアプリを前面に戻したときなど）に新しい版が届くと、ゲーム画面の下に「新しい版があります」が出るので、「再読み込み」を押すと切り替わる（ゲーム内セーブを書き出してから読み込み直す。勝手には読み込み直さない）。

メニューの一番下の「バージョン: 2026-10-24 12:34 (abc1234)」は、ビルドした日時（日本時間）と git の短いコミットハッシュ。ビルドしたときにコミットしていない変更（追跡していないファイルも含む）があれば、ハッシュの後ろに `+` が付く。更新できたかどうかは、これが上げた版と同じかで確かめる。Service Worker の版（`dist/sw.js` の `VERSION`、`dist/` の中身のハッシュ）とは別物（`docs/pwa-and-deploy.md`）。

## 本家のコードを読む

本家のソースはリポジトリに入れていない（パッチだけを入れている）。読むときは次のどちらか:

- 一度ビルドしたあとの `core/upstream/`（パッチを当てたもの。`git -C core/upstream log` で本家のコミットとパッチの 1 本ずつが見える）
- GitHub の固定したコミット（パッチを当てる前）: https://github.com/smparsons/retroboy/tree/edf90d9fb192372a657a18d44f5c9841805fa554

## 本家のコードに手を入れる

本家への変更は `core/patches/` のパッチ（1 つの目的に 1 本）で持つ。`scripts/prepare-core.sh`（`scripts/build-wasm.sh` と `scripts/test-core.sh` が最初に呼ぶ）が、`core/upstream/` を `core/upstream.rev` のコミットにして、パッチを `git am` で 1 本ずつコミットとして当てる。当て終えた状態を覚えていて、本家のコミットもパッチも変わっていなければ何もしない（ファイルを触らないので、Cargo が本家を作り直さない）。

パッチを直す・足すとき:

```sh
./scripts/prepare-core.sh            # core/upstream/ を今のパッチの状態にする
# core/upstream/ のコードを直して、本家のフォルダでコミットする
#   直すパッチがあるなら: git -C core/upstream commit --fixup=<そのコミット> のあと
#   GIT_SEQUENCE_EDITOR=true git -C core/upstream rebase -i --autosquash <core/upstream.rev のコミット>
#   新しいパッチなら: そのまま git -C core/upstream commit（件名は英語で短く。パッチのファイル名になる）
./scripts/export-core-patches.sh     # core/patches/ を書き出し直す
./scripts/test-core.sh               # 本家の単体試験と 2 台直結の試験
```

`core/upstream/` にコミットしていない変更があると、`scripts/prepare-core.sh` は消さずに止まる（コミットして書き出すか、`core/upstream/` を消してからやり直す）。作業ツリーがきれいなら、前に当てた状態と違っていても（途中で止まった・パッチに書き出していないコミットがある）作り直す。そのときは前の HEAD を `refs/retroboy-snap/previous-head` に残して知らせるので、書き出し忘れたコミットは `git -C core/upstream log refs/retroboy-snap/previous-head` で取り出せる。本家のコードの書き方（コメントは少なく英語、`mod` はファイルの最後）は本家の `CLAUDE.md` に合わせる。

## 本家の版を上げるとき

```sh
# core/upstream.rev を新しいコミットのフルハッシュに書き換えてから
./scripts/prepare-core.sh
cargo update --manifest-path core/Cargo.toml   # 本家の依存が変わったときだけ Cargo.lock が変わる
./scripts/test-core.sh
./scripts/build-wasm.sh
```

パッチが当たらなければ `scripts/prepare-core.sh` が止まる。そのときは新しいコミットの上で `git -C core/upstream am <パッチ>` を手で進め、ぶつかった所を直して `git -C core/upstream am --continue` し、`scripts/export-core-patches.sh` で書き出し直す。本家が通信ケーブルを作り込んだら、パッチをやめて本家の作りに乗り換えることを考える（`docs/link-cable-design.md` 2.1）。

`core/upstream.rev`・`core/patches/`・`core/Cargo.lock` を一緒にコミットする（`scripts/build-wasm.sh` は `--locked` でビルドするので、`Cargo.lock` を更新し忘れると失敗する）。あわせて、移したファイルの先頭と `NOTICE` に書いたコミットを更新し、`docs/upstream-notes.md` の内容が変わっていないか確かめる（特にセーブステートの版が上がると、古いセーブステートは読めなくなる）。

## テスト ROM

自作のテスト ROM は `testroms/` に、RGBDS のソースとできた ROM を一緒に入れている（自作なので入れてよい。`.gitignore` は `testroms/` と `games/` の中の ROM だけを例外にしている）。ソースを直したら RGBDS（`brew install rgbds`）で作り直し、ROM もコミットする。

```sh
./scripts/build-testroms.sh           # testroms/link/linktest.gb を作り直す（途中の生成物は testroms/build/）
./scripts/build-testroms.sh --check   # 作り直した ROM がリポジトリの ROM と同じかだけを見る（scripts/test-core.sh が使う）
```

`testroms/link/link.asm` は通信ケーブルのテスト ROM（GB / GBC 両用）。

| ボタン | 内容 |
|---|---|
| A / B | 親機（内部クロック）で送り続ける / 子機（外部クロック）で受け続ける |
| 上 / 下 | AUTO（子機で待ち、来なければ親機を試す。ゲームによくある役の決め方）/ 止める |
| SELECT / START | 高速クロック / CPU の倍速モード（どちらも GBC のみ） |

画面には、最後に送った・受け取ったバイト（SENT / RECV）、並びが合った数と合わなかった数（OK / ERR）、子機で 0.5 秒受け取れなかった回数（TOUT）、1 秒に受け渡したバイト数（BPS）が出る。つないでいないときに親機にすると、RECV が FF のまま ERR が増え続ける（実機と同じ）。アプリで試すときは、ほかの ROM と同じく「ROM を追加」で選ぶ（ヘッダで GBC 対応にしてあるので、アプリでは GBC として動く）。

## 通信ケーブル

同じ Wi-Fi の 2 台の iPhone で、ゲームボーイの通信ケーブル（交換・対戦）をまねる（設計は `docs/link-cable-design.md`）。サーバーは使わず、2 台が QR を 1 回ずつ読み合って WebRTC で直接つながる。ROM は送らないので、2 台ともつなぐゲームの ROM を入れておく。

つなぎ方:

1. 2 台を同じ Wi-Fi につなぐ（Wi-Fi が無ければ、片方の「インターネット共有」にもう片方をつなぐ）。どちらもゲームを始めておく。
2. A: 「メニュー」→「通信ケーブルでつなぐ」→「QR を出す（先に始める）」。カメラの許可を聞かれたら許可する（あとで相手の QR を読むのに使う。許可しないと Wi-Fi によってはつながりにくい）。QR ① が出る。
3. B: 「メニュー」→「通信ケーブルでつなぐ」→「QR を読む」→ カメラで A の QR ① を読む。QR ② が出る。
4. A: 「相手の QR を読む」→ カメラで B の QR ② を読む。両方に「つながりました」が出たら「閉じてゲームに戻る」。
5. あとはゲームの中で通信する。終わったら「メニュー」→「通信を切る」。

- カメラが使えないときは、QR の下の「コードをコピー」でコードを相手に送り（AirDrop・メッセージ）、読む画面の欄に貼り付けて「このコードでつなぐ」。
- つないでいる間は、倍速ボタンの所に「通信中 8ms」（往復の時間）が出て ×1 に固定になり、ロード（画面の「ロード」とファイルからの読み込み）はできない。通信している間はゲームがゆっくり進み（往復 10ms ほどで 1 秒に 100 バイトほど）、音が途切れる。短く押したボタンも、ゲームの中で 1 フレームは押したままにして伝える（取りこぼさないように）。
- 相手を待って 0.3 秒止まると「相手を待っています…」（相手が一時停止中なら「相手が一時停止しています…」、相手のゲームが始まっていなければ「相手のゲームが始まるのを待っています…」）、相手から 5 秒なにも届かないと「相手から応答がありません」と「通信を切る」が出る。切れたら（片方がホームに戻ってしばらくたつなど）、ゲームはそのまま続き、もう一度 QR からつなぎ直す。
- 「つながりませんでした」が出るときは、2 台が同じ Wi-Fi か、Wi-Fi に「端末どうしの通信を禁止する」設定（ゲスト用・公衆 Wi-Fi に多い）が無いかを確かめる。

開発・試験用:

- `npm run dev` で `/link-test.html` を開くと、アプリが 2 つ横に並び、同じブラウザの中の道（BroadcastChannel）でつながる。それぞれ「タップして開始」を押す。テスト ROM（上）なら、片方で B（子機）、もう片方で A（親機）を押すと受け渡しが始まる。URL に `?linkDelay=10&linkJitter=5` を付けると、送るものを片道 10ms 遅らせ、さらに 0〜5ms の揺れを足す。`&linkWindow=16` で、相手より先に進んでよい時間（既定 32ms）を変えられる。`&sound=1` で 2 つのアプリの音を鳴らす（既定は無音）。
- `/link-test.html?mode=webrtc` では自動ではつながず、それぞれのメニューの「通信ケーブルでつなぐ」から WebRTC でつなぐ（コードのコピー・貼り付けで）。
- `scripts/link-e2e.mjs` は、`/link-test.html?mode=webrtc` で、QR を出す → 偽のカメラで読む → つながる → テスト ROM で受け渡す、を Playwright の WebKit で通して、各段の画面（390x844）を書き出す。使い方はファイルの先頭。
- アプリの URL に直接 `?link=tab`（`&room=<名前>` で組を分ける）を付けても、同じ room の別のタブ・窓とつながる。ただし裏に回ったタブはブラウザがタイマーを間引くので、とても遅くなる。窓を 2 つ横に並べるか、`/link-test.html` を使う。
- 開発時は、各アプリの `window.__retroboyLink()` で、コアの時刻・止まった回数と時間・離すのを遅らせているボタン・つながりの状態を読める。

## GBA（試し）

GB だと苦しくなったら自作ゲームを GBA に移すかを決めるために、GBA の ROM（`.gba`）も動かせるようにしてある（試しの段階）。
いちばんの論点は、iPhone の Safari（ホーム画面のアプリ）で等速に動くかと、音が途切れないか。

- コア: mGBA 0.10.5（MPL-2.0）。本家を rev 固定で取ってきてパッチを当て、GBA のコアだけを Emscripten で WASM にする
  （`scripts/build-mgba.sh`。WASM 約 630KB・JS 約 14KB）。npm のビルド済みの包み（`@thenick775/mgba-wasm`）は、
  スレッド（SharedArrayBuffer）を使い cross-origin isolation（COOP/COEP のヘッダ）が要るので使わない。GitHub Pages は
  ヘッダを付けられず、Service Worker で付け直す細工（coi-serviceworker など）は初回の読み込み直しや、いまの Service Worker と
  の取り合いがあるため。スレッドなしで作り、JS から 1 フレームずつ進める（Game Boy と同じくメインスレッドで動く）。
- 振り分け: 名前が `.gba` か、ヘッダが GBA の形なら mGBA、それ以外は Retro Boy（`app/src/storage/romSystem.ts`）。
  mGBA の WASM は GBA のゲームを初めて始めるときに読み込む。
- 同じもの: ROM の登録（IndexedDB・SHA-256 の ID）、前回の ROM の自動読み込み、ゲーム内セーブ（localStorage `sram:<ROM の ID>`。
  10 秒ごとと画面を離れるとき）、画面の「セーブ」「ロード」とセーブステートのファイル（GBA は `<名前>.ss1`。mGBA の形式）。
  `.ss1` にはゲーム内セーブも入れる（別の端末へ引っ越せるように。前の版の `.ss1` には無く、そのまま読める）。入った `.ss1` を
  読み込むときは「ゲーム内セーブも置き換えますか？」を聞き、はいなら端末のゲーム内セーブもすぐ置き換える。画面の「セーブ」には入れない。
- GBA で使えないもの: 倍速（ボタンを隠す）。
- 通信ケーブル（GBA）: GB・GBC と同じ画面（QR・コードの貼り付け）でつなぎ、GBA どうしで通信する。いまはノーマルモード
  （8 ビット・32 ビット）だけ。マルチプレイ・UART などはつながっていないのと同じに見える。GBA と GB・GBC のあいだでは通信しない
  （`docs/link-cable-design.md` 8 章。試すのは内蔵ソフトの「GBA 通信テスト」）。
- 画面: 240x160 を、縦横の比（3:2）を保って横幅いっぱいに広げる（整数倍にしない。画面枠の左右の縁も細くする）。拡大は pixelated でぼかさないが、整数倍でないのでドットの太さが 1 ピクセルずつ不ぞろいになる（iPhone 15 で 4 と 5 ピクセル、SE で 2 と 3 ピクセル）。GB / GBC は今までどおり整数倍。L・R は操作部の上の左右の角（画面のすぐ下の肩）に、GBA のゲームのときだけ出る。
- 速さの表示: 画面の左上に「59.7fps / 100%」・音切れの回数・1 フレームの処理の時間（ms）を出す（`app/src/ui/PerfOverlay.tsx`）。
  メニューの「速さの表示」で出す・出さないを切り替え、GBA と GB・GBC で別々に覚える（GBA は初めから出す）。
  音切れは、次の音を予約するときにもう前の音が鳴り終わっていた回数（その間は無音）。GB の倍速の切り替えの直後にも数える。
- 音の先読み（GBA）: 先に作って予約しておく音の長さ。メニューの「速さの表示」で 33 / 50 / 67 / 100ms から選ぶ（既定は 50ms。
  端末に覚える）。長いほどタイマーの遅れで音が途切れにくく、短いほどボタンの反応が速い（`app/src/gba/gbaLead.ts`）。
- 試し用の ROM: 内蔵ソフトの「GBA ベンチ」（`games/gba-bench/`。スプライト 128 個・回転の背景・鳴り続ける音）。

## ライセンス

Apache License 2.0（`LICENSE`）。本家 Retro Boy（Apache-2.0）のコードを含む。詳しくは `NOTICE`。
