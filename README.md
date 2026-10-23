# retroboy-snap

[Retro Boy](https://github.com/smparsons/retroboy) のエミュレーターコアを使った、iPhone のホーム画面で遊ぶための個人用 Game Boy エミュレーター。

- `vendor/retroboy/` … 本家 Retro Boy の git submodule（コミット固定・変更しない）。Rust のコアを WASM にビルドして使う。
- `app/` … Vite + React + TypeScript のアプリ。本家 `frontends/web` から移したつなぎのコードは `app/src/emulator/`。
- `scripts/build-wasm.sh` … コアを WASM にビルドして `app/src/core/` に出力する（生成物は git に入れない）。
- `docs/upstream-notes.md` … 本家のセーブ RAM・セーブステート・WASM API の調査メモ。

ROM ファイルはリポジトリにもビルド成果物にも入れない。

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
# 1. submodule の取得（clone 時なら git clone --recurse-submodules でもよい）
git submodule update --init

# 2. コアを WASM にビルド（app/src/core/ に出力。コアを更新したら再実行）
./scripts/build-wasm.sh

# 3. アプリの依存を入れて起動
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

## 本家の版を上げるとき

```sh
cd vendor/retroboy
git fetch && git checkout <新しいコミット>
cd ../..
git add vendor/retroboy
```

あわせて、移したファイルの先頭と `NOTICE` に書いたコミットを更新し、`docs/upstream-notes.md` の内容が変わっていないか確かめる（特にセーブステートの版が上がると、古いセーブステートは読めなくなる）。

## ライセンス

Apache License 2.0（`LICENSE`）。本家 Retro Boy（Apache-2.0）のコードを含む。詳しくは `NOTICE`。
