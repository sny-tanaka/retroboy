#!/usr/bin/env bash
# コアの試験: パッチを当てた本家の単体試験（serial などの試験はパッチに入っている）と、
# 通信テスト ROM で 2 台を直結する試験（core/tests/link.rs）を流す。
# テスト ROM はリポジトリに入っているもの（testroms/link/linktest.gb）を使う。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# scripts/build-wasm.sh と同じく、rustup 側の cargo を優先する
if command -v brew >/dev/null 2>&1; then
  RUSTUP_PREFIX="$(brew --prefix rustup 2>/dev/null || true)"
  if [ -n "$RUSTUP_PREFIX" ] && [ -x "$RUSTUP_PREFIX/bin/rustup" ]; then
    export PATH="$RUSTUP_PREFIX/bin:$PATH"
  fi
fi

"$ROOT/scripts/prepare-core.sh"

# テスト ROM はリポジトリに入っているものを使う。RGBDS があれば、ソースから作り直したものと同じかも確かめる
if command -v rgbasm >/dev/null 2>&1; then
  "$ROOT/scripts/build-testroms.sh" --check
else
  echo "rgbasm が無いので、テスト ROM がソースと合っているかは確かめません（brew install rgbds）。"
fi

# 本家の試験は本家のフォルダで流す（本家のワークスペースの他のフロントエンドは入れない）。
# ビルド先は core/target/ にまとめる（core/upstream/ の中に生成物を作らない）
cargo test --release --locked --manifest-path "$ROOT/core/upstream/Cargo.toml" \
  --target-dir "$ROOT/core/target" -p retroboy --lib
cargo test --release --locked --manifest-path "$ROOT/core/Cargo.toml"
