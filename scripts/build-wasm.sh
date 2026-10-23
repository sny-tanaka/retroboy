#!/usr/bin/env bash
# core/（本家 Retro Boy のコアを Cargo の git 参照で取り込むクレート）を WASM にビルドし、
# app/src/core/ に retroboyCore.js / retroboyCore_bg.wasm などを出力する。
# 本家のソースは初回のビルドで Cargo が取ってくる（版は core/Cargo.toml の rev と core/Cargo.lock で固定）。
# 本家 Makefile の build-wasm と同じ wasm-pack の呼び方（--target web --out-name retroboyCore --release）。
# 生成物は git に入れない（app/src/core/ と core/target/ は .gitignore 済み）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$ROOT/core"
OUT_DIR="$ROOT/app/src/core"

# Homebrew の rustup は keg-only なので、入っていれば rustup 側の cargo を優先する
# （Homebrew の rust には wasm32-unknown-unknown ターゲットが無いため）。
if command -v brew >/dev/null 2>&1; then
  RUSTUP_PREFIX="$(brew --prefix rustup 2>/dev/null || true)"
  if [ -n "$RUSTUP_PREFIX" ] && [ -x "$RUSTUP_PREFIX/bin/rustup" ]; then
    export PATH="$RUSTUP_PREFIX/bin:$PATH"
  fi
fi

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack が見つかりません。README の「必要なツール」を参照してください。" >&2
  exit 1
fi

# --locked: core/Cargo.lock と食い違うときは書き換えずに失敗させる（版を勝手に動かさない）
wasm-pack build "$CORE_DIR" --target web --out-dir "$OUT_DIR" --out-name retroboyCore --release -- --locked
