#!/usr/bin/env bash
# core/upstream/ の、本家のコミット（core/upstream.rev）より後のコミットを、1 コミット 1 本の
# パッチとして core/patches/ に書き出し直す（前のパッチは消す）。コミットしていない変更があれば止まる。
# 書き出したあとは、scripts/prepare-core.sh がそのまま通るよう、当て終えた状態の記録も更新する。
# 引数に mgba を付けると mgba/upstream/ → mgba/patches/（scripts/prepare-core.sh と同じ）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# どの本家か（引数。省くと Retro Boy）: retroboy = core/（smparsons/retroboy）、mgba = mgba/（mgba-emu/mgba。GBA のコア）
case "${1:-retroboy}" in
  retroboy) BASE="core" ;;
  mgba) BASE="mgba" ;;
  *) echo "使い方: $0 [retroboy|mgba]" >&2; exit 1 ;;
esac
UPSTREAM="$ROOT/$BASE/upstream"
PATCH_DIR="$ROOT/$BASE/patches"
REV="$(tr -d '[:space:]' < "$ROOT/$BASE/upstream.rev")"
STAMP="$UPSTREAM/.git/retroboy-snap-stamp"

if [ -n "$(git -C "$UPSTREAM" status --porcelain)" ]; then
  echo "$BASE/upstream/ にコミットしていない変更があります。コミットしてから実行してください。" >&2
  exit 1
fi

rm -f "$PATCH_DIR"/*.patch
# --zero-commit・--no-signature: 当て直すたびにコミットのハッシュが変わっても、パッチの中身が変わらないように
git -C "$UPSTREAM" format-patch -q --zero-commit --no-signature -o "$PATCH_DIR" "$REV..HEAD"

patch_hash="$(cat "$PATCH_DIR"/*.patch | shasum -a 256 | cut -d' ' -f1)"
echo "$REV $patch_hash $(git -C "$UPSTREAM" rev-parse HEAD)" > "$STAMP"
ls "$PATCH_DIR"
