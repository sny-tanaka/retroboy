#!/usr/bin/env bash
# vendor/retroboy（本家 Retro Boy の submodule）のコアを WASM にビルドし、
# app/src/core/ に retroboyCore.js / retroboyCore_bg.wasm などを出力する。
# 本家 Makefile の build-wasm と同じ wasm-pack の呼び方（--target web --out-name retroboyCore --release）。
# 生成物は git に入れない（app/src/core/ は .gitignore 済み）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$ROOT/vendor/retroboy"
OUT_DIR="$ROOT/app/src/core"

# Homebrew の rustup は keg-only なので、入っていれば rustup 側の cargo を優先する
# （Homebrew の rust には wasm32-unknown-unknown ターゲットが無いため）。
if command -v brew >/dev/null 2>&1; then
  RUSTUP_PREFIX="$(brew --prefix rustup 2>/dev/null || true)"
  if [ -n "$RUSTUP_PREFIX" ] && [ -x "$RUSTUP_PREFIX/bin/rustup" ]; then
    export PATH="$RUSTUP_PREFIX/bin:$PATH"
  fi
fi

if [ ! -f "$CORE_DIR/Cargo.toml" ]; then
  echo "vendor/retroboy が空です。先に git submodule update --init を実行してください。" >&2
  exit 1
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack が見つかりません。README の「必要なツール」を参照してください。" >&2
  exit 1
fi

wasm-pack build "$CORE_DIR" --target web --out-dir "$OUT_DIR" --out-name retroboyCore --release
