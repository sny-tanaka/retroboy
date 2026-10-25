#!/usr/bin/env bash
# core/upstream/ の、本家のコミット（core/upstream.rev）より後のコミットを、1 コミット 1 本の
# パッチとして core/patches/ に書き出し直す（前のパッチは消す）。コミットしていない変更があれば止まる。
# 書き出したあとは、scripts/prepare-core.sh がそのまま通るよう、当て終えた状態の記録も更新する。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$ROOT/core/upstream"
PATCH_DIR="$ROOT/core/patches"
REV="$(tr -d '[:space:]' < "$ROOT/core/upstream.rev")"
STAMP="$UPSTREAM/.git/retroboy-snap-stamp"

if [ -n "$(git -C "$UPSTREAM" status --porcelain)" ]; then
  echo "core/upstream/ にコミットしていない変更があります。コミットしてから実行してください。" >&2
  exit 1
fi

rm -f "$PATCH_DIR"/*.patch
# --zero-commit・--no-signature: 当て直すたびにコミットのハッシュが変わっても、パッチの中身が変わらないように
git -C "$UPSTREAM" format-patch -q --zero-commit --no-signature -o "$PATCH_DIR" "$REV..HEAD"

patch_hash="$(cat "$PATCH_DIR"/*.patch | shasum -a 256 | cut -d' ' -f1)"
echo "$REV $patch_hash $(git -C "$UPSTREAM" rev-parse HEAD)" > "$STAMP"
ls "$PATCH_DIR"
