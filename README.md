# retroboy-snap

[Retro Boy](https://github.com/smparsons/retroboy) のエミュレーターコアを使った、iPhone のホーム画面で遊ぶための個人用 Game Boy エミュレーター。

- `core/` … 本家 Retro Boy のコアを Cargo の git 参照（コミット固定・変更しない）で取り込むだけの Rust クレート。これを WASM にビルドして使う。版は `core/Cargo.toml` の `rev` と `core/Cargo.lock` で固定する。
- `app/` … Vite + React + TypeScript のアプリ。本家 `frontends/web` から移したつなぎのコードは `app/src/emulator/`。
  - `app/src/storage/` … ROM を端末内（IndexedDB）に保存する処理と、保存領域の永続化（`navigator.storage.persist()`）。
  - `app/src/session/useRomSession.ts` … 画面の状態とロジック（ROM の追加・自動読み込み・起動・停止）。`App.tsx` は見た目だけ。
  - `app/public/` … Web App Manifest とアイコン。`app/sw/sw.template.js` が Service Worker の本体で、`app/scripts/generate-sw.mjs` がビルド後に `dist/sw.js` を作る。
  - `app/src/ui/` … ゲームボーイカラー風の本体の部品（画面枠・ぷにコン・A/B・SELECT/START・メニュー）。`npm run dev` で `/preview.html` を開くと、エミュレーターに繋がずに見た目と押した反応を確かめられる。
- `scripts/build-wasm.sh` … コアを WASM にビルドして `app/src/core/` に出力する（生成物は git に入れない）。
- `scripts/make-icons.sh` … アイコンの元画像から `app/public/icons/` の PNG を作る。
- `netlify.toml` … Netlify での配信の設定（公開するフォルダとヘッダー）。
- `docs/pwa-and-deploy.md` … ホーム画面アプリ（PWA）・Service Worker・Netlify 配信の仕組みと、アイコンの作り方。
- `docs/upstream-notes.md` … 本家のセーブ RAM・セーブステート・WASM API の調査メモと、このアプリでの変更点。
- `docs/future-work.md` … 今後の課題（ゲーム内セーブのバックアップなど）。

ROM ファイルはリポジトリにもビルド成果物にも入れない。

## 使い方

画面はゲームボーイカラー風の本体で、iPhone の縦持ちで使う。

1. 初回はゲーム画面の中の「ROM を追加」で ROM ファイル（`.gb` / `.gbc`）を選ぶ。ROM は端末内（IndexedDB）に保存され、そのまま始まる。
2. 次からは開くと前回の ROM が読み込まれるので、ゲーム画面の「タップして開始」を押す（iPhone は音を鳴らすのにタップが要るため）。
3. ほかの ROM は「メニュー」の一覧で選ぶか、「＋ ROM を追加」で足す。遊んでいる途中でも切り替えられる。

操作:

| 部品 | 内容 |
|---|---|
| 左下のぷにコン | 方向（8 方向）。左側のどこを触っても触った所が中心になり、指をずらした向きが入る。指を離さずに回して方向を変えられる |
| A / B・SELECT / START | そのままのボタン。B と A の間を押すと両方が入る |
| 画面の下の「メニュー」 | ROM の一覧と切り替え・追加、セーブステートのファイルの書き出しと読み込み、保存の状態（永続化・使用量） |
| 「一時停止」 | 一時停止と再開 |
| 「セーブ」 | セーブステートを `.rbs` ファイルに書き出す（端末内には残らない） |
| 「ロード」 | 確認のあと、`.rbs` ファイルを選んで読み込む（いまの進みは上書きされる） |

メニュー・確認・ファイル選択を開いている間はゲームが止まり、閉じると元に戻る。キーボードでも操作できる（下の「キーボードでの操作」）。

端末に保存されるもの（外へは送らない）:

| もの | 場所 |
|---|---|
| ROM 本体と名前（ID は中身の SHA-256）、前回の ROM | IndexedDB `retroboy-snap` |
| ゲーム内セーブ（セーブ RAM・RTC）。ROM ごとに分かれる | localStorage `sram:<ROM の ID>` / `rtc:<ROM の ID>` |

ゲーム内セーブは 10 秒ごとにまとめて書き（変化が無ければ書かない）、画面を離れるとき（ホームに戻す・閉じる）にはすぐ書く。サイトデータの削除などで消えるので、バックアップは今後の課題（`docs/future-work.md`）。

ROM の ID の計算（`crypto.subtle`）は HTTPS か `localhost` でしか動かない。iPhone から開発サーバーに `http://<PC の IP>` でつなぐと ROM を追加できない。

## 必要なツール

- Node.js 22 以上（npm）
- rustup で入れた Rust と `wasm32-unknown-unknown` ターゲット
- wasm-pack

macOS（Homebrew）の例:

```sh
brew install rustup wasm-pack
# rustup は keg-only なので PATH に入らない。scripts/build-wasm.sh は自動で rustup 側を優先する
"$(brew --prefix rustup)/bin/rustup" default stable
"$(brew --prefix rustup)/bin/rustup" target add wasm32-unknown-unknown
```

Homebrew の `rust` が入っていても消す必要はない（`rust` には wasm32 ターゲットが無いので、ビルドには rustup 側の cargo を使う）。

## 開発手順

```sh
# 1. コアを WASM にビルド（app/src/core/ に出力。本家の版を変えたら再実行）
#    初回は Cargo が本家のソースを GitHub から取ってくる
./scripts/build-wasm.sh

# 2. アプリの依存を入れて起動
cd app
npm ci
npm run dev        # http://localhost:5173
```

## まとめて検査する

CI は置いていない（プライベートリポジトリのため）。PR を出す前に手元で次を流す:

```sh
cd app
npm run check
```

WASM のビルド → 型チェック → lint → 本番ビルドを順に実行し、どれかが失敗したらそこで止まる。

その他のコマンド（`app/` で実行）:

| コマンド | 内容 |
|---|---|
| `npm run check` | WASM のビルド・型チェック・lint・本番ビルドをまとめて実行 |
| `npm run typecheck` | 型チェック |
| `npm run lint` | ESLint |
| `npm run build` | 型チェックして `app/dist/` に本番ビルド |
| `npm run preview` | 本番ビルドをローカルで配信（Service Worker も動く） |
| `npm run deploy` | `npm run check` を通してから Netlify の本番に上げる（下の「Netlify に公開する」） |
| `npm run build:wasm` | `../scripts/build-wasm.sh` と同じ |

キーボードでの操作: 方向 = 矢印キー / A = Z / B = X / START = Enter / SELECT = Space

## Netlify に公開する

Netlify の無料プランで、自分（チームオーナー）だけが見られる **Private** の状態で配信する。ビルドは手元で行い、`app/dist/` を netlify-cli で上げる（Netlify 側ではビルドしない）。netlify-cli は依存に入れず、`npx` で版を固定して使う。仕組みは `docs/pwa-and-deploy.md`。

### 初回だけ

リポジトリの一番上で実行する。

1. Netlify のアカウントを作る（無料プラン）。
2. ログインする: `npx --yes netlify-cli@27.14.2 login`（ブラウザが開くので許可する）
3. 空のプロジェクトを作ってこのフォルダにつなぐ: `npx --yes netlify-cli@27.14.2 sites:create --name <好きな名前>`（`.netlify/` ができる。git には入れない）
   - 別の PC でつなぎ直すときは `npx --yes netlify-cli@27.14.2 link --name <名前>`。
4. **最初のデプロイの前に** Netlify の画面で Private にする: プロジェクトを開き、**Project configuration > General > Visitor access > Project visibility** で **Private** を選んで保存する。
   - チーム全体の既定にしておくなら **Team settings > General > Visitor access > Default project visibility** で「Private for all projects」。
   - 無料プランでは、Private のプロジェクトを見られるのはチームオーナーだけ。ログインしていない人には「アクセスできない」という Netlify の画面が出る。

### 毎回

```sh
cd app
npm run deploy     # npm run check（WASM のビルド・型チェック・lint・本番ビルド）→ 本番に上げる
```

上げたあと、ログインしていないブラウザ（プライベートブラウズなど）で URL を開いて、中身が見えないことを確かめる。

### iPhone のホーム画面に入れる

1. iPhone の Safari で URL を開き、Netlify にログインする。
2. 共有ボタン →「ホーム画面に追加」。
3. ホーム画面のアイコンから開く。ホーム画面アプリは Safari と保存領域が別のことがあるので、ROM の追加とセーブの確かめはホーム画面アプリの中で行う（設計書 Step 7）。

一度開けば、オフラインでも起動する（アプリ本体を Service Worker がキャッシュする）。新しい版を上げたあとは、オンラインで開き直すと新しい版になる（閉じずに裏に回っていたときは、アプリの切り替え画面で上にスワイプして閉じてから開く）。

## 本家のコードを読む

本家のソースはリポジトリに入れていない。読むときは次のどちらか:

- GitHub の固定したコミット: https://github.com/smparsons/retroboy/tree/edf90d9fb192372a657a18d44f5c9841805fa554
- 一度ビルドしたあとの Cargo のチェックアウト先: `~/.cargo/git/checkouts/retroboy-<ハッシュ>/edf90d9/`（`CARGO_HOME` を変えていればその下）

## 本家の版を上げるとき

```sh
# core/Cargo.toml の rev を新しいコミットのフルハッシュに書き換えてから
cargo update --manifest-path core/Cargo.toml -p retroboy
./scripts/build-wasm.sh
```

`core/Cargo.toml` と `core/Cargo.lock` を一緒にコミットする（`scripts/build-wasm.sh` は `--locked` でビルドするので、`Cargo.lock` を更新し忘れると失敗する）。あわせて、移したファイルの先頭と `NOTICE` に書いたコミットを更新し、`docs/upstream-notes.md` の内容が変わっていないか確かめる（特にセーブステートの版が上がると、古いセーブステートは読めなくなる）。

## ライセンス

Apache License 2.0（`LICENSE`）。本家 Retro Boy（Apache-2.0）のコードを含む。詳しくは `NOTICE`。
