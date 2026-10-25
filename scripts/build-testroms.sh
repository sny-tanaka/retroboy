#!/usr/bin/env bash
# 自作のテスト ROM（testroms/）を RGBDS でビルドする。できた ROM はソースの隣（testroms/link/linktest.gb）に
# 置き、ソースと一緒にリポジトリに入れる（自作なので入れてよい。市販 ROM を入れない .gitignore の例外）。
# 途中の生成物（.o・.sym）は testroms/build/ に出す（git に入れない）。RGBDS が要る（brew install rgbds）。
#
# --check: ビルドし直した ROM が、リポジトリに入っている ROM と同じかだけを確かめる（書き換えない）。
#   scripts/test-core.sh が使う（asm を直して ROM を作り直し忘れたら止める）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT/testroms/build"
ROM="$ROOT/testroms/link/linktest.gb"

check=false
if [ "${1:-}" = "--check" ]; then
  check=true
fi

if ! command -v rgbasm >/dev/null 2>&1; then
  echo "rgbasm が見つかりません。README の「必要なツール」を参照してください（brew install rgbds）。" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"

# 通信ケーブルのテスト ROM。-c: GBC 対応（GB でも動く）、-m 0: ROM のみ、-t: タイトル
rgbasm -Weverything -o "$BUILD_DIR/linktest.o" "$ROOT/testroms/link/link.asm"
rgblink -o "$BUILD_DIR/linktest.gb" -n "$BUILD_DIR/linktest.sym" "$BUILD_DIR/linktest.o"
rgbfix -v -c -m 0 -r 0 -p 0xFF -t LINKTEST "$BUILD_DIR/linktest.gb"

if $check; then
  if ! cmp -s "$BUILD_DIR/linktest.gb" "$ROM"; then
    echo "testroms/link/linktest.gb が testroms/link/link.asm から作ったものと違います。" >&2
    echo "scripts/build-testroms.sh で作り直して、ROM もコミットしてください。" >&2
    exit 1
  fi
else
  cp "$BUILD_DIR/linktest.gb" "$ROM"
  echo "testroms/link/linktest.gb を作りました。"
fi
