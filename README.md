# retroboy-snap

[Retro Boy](https://github.com/smparsons/retroboy) のエミュレーターコアを使った、iPhone のホーム画面で遊ぶための個人用 Game Boy エミュレーター。

- `core/` … 本家 Retro Boy のコアを Cargo の git 参照（コミット固定・変更しない）で取り込むだけの Rust クレート。これを WASM にビルドして使う。版は `core/Cargo.toml` の `rev` と `core/Cargo.lock` で固定する。
- `app/` … Vite + React + TypeScript のアプリ。本家 `frontends/web` から移したつなぎのコードは `app/src/emulator/`。
  - `app/src/storage/` … ROM を端末内（IndexedDB）に保存する処理と、保存領域の永続化（`navigator.storage.persist()`）。
  - `app/src/session/useRomSession.ts` … 画面の状態とロジック（ROM の追加・自動読み込み・起動・停止）。`App.tsx` は見た目だけ。
- `scripts/build-wasm.sh` … コアを WASM にビルドして `app/src/core/` に出力する（生成物は git に入れない）。
- `docs/upstream-notes.md` … 本家のセーブ RAM・セーブステート・WASM API の調査メモと、このアプリでの変更点。
- `docs/future-work.md` … 今後の課題（ゲーム内セーブのバックアップなど）。

ROM ファイルはリポジトリにもビルド成果物にも入れない。

## 使い方

1. 初回は「ROM を追加」で ROM ファイル（`.gb` / `.gbc`）を選ぶ。ROM は端末内（IndexedDB）に保存され、そのまま始まる。
2. 次からは開くと前回の ROM が読み込まれるので、「タップして開始」を押す（iPhone は音を鳴らすのにタップが要るため）。
3. ほかの ROM は「止める」を押してから、「保存した ROM」の一覧で選ぶか「ROM を追加」で足す。

端末に保存されるもの（外へは送らない）:

| もの | 場所 |
|---|---|
| ROM 本体と名前（ID は中身の SHA-256）、前回の ROM | IndexedDB `retroboy-snap` |
| ゲーム内セーブ（セーブ RAM・RTC）。ROM ごとに分かれる | localStorage `sram:<ROM の ID>` / `rtc:<ROM の ID>` |

ゲーム内セーブは最後の書き込みから 2 秒後（書き込みが続いても 10 秒以内）にまとめて書き、画面を離れるとき（ホームに戻す・閉じる）にはすぐ書く。サイトデータの削除などで消えるので、バックアップは今後の課題（`docs/future-work.md`）。

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
| `npm run preview` | 本番ビルドをローカルで配信 |
| `npm run build:wasm` | `../scripts/build-wasm.sh` と同じ |

操作: 十字キー = 矢印キー / A = Z / B = X / START = Enter / SELECT = Space

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
