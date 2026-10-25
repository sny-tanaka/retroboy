#!/usr/bin/env bash
# 本家 Retro Boy を core/upstream.rev のコミットで core/upstream/ に取ってきて、core/patches/*.patch を
# git am で当てる（core/Cargo.toml はこの core/upstream/ を path 依存で使う）。core/upstream/ は git に入れない。
# 当て終えた状態（本家のコミット・パッチの中身・できたコミット）を core/upstream/.git/retroboy-snap-stamp に
# 覚え、変わっていなければ何もしない（ファイルを触らないので、Cargo が本家を作り直さない）。
# core/upstream/ に書き出していない変更（コミットしていない変更・パッチにしていないコミット）があれば、
# 消さずに止まる。パッチを直す手順は README の「本家のコードに手を入れる」。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPSTREAM="$ROOT/core/upstream"
PATCH_DIR="$ROOT/core/patches"
REV="$(tr -d '[:space:]' < "$ROOT/core/upstream.rev")"
REMOTE="https://github.com/smparsons/retroboy.git"
STAMP="$UPSTREAM/.git/retroboy-snap-stamp"

patches=("$PATCH_DIR"/*.patch)
patch_hash="$(cat "${patches[@]}" | shasum -a 256 | cut -d' ' -f1)"
want="$REV $patch_hash"

if [ ! -d "$UPSTREAM/.git" ]; then
  mkdir -p "$UPSTREAM"
  git -C "$UPSTREAM" init -q
  git -C "$UPSTREAM" remote add origin "$REMOTE"
fi

head="$(git -C "$UPSTREAM" rev-parse -q --verify HEAD || true)"
dirty="$(git -C "$UPSTREAM" status --porcelain)"

if [ -f "$STAMP" ]; then
  read -r stamp_rev stamp_hash stamp_head < "$STAMP"
  if [ -z "$dirty" ] && [ "$head" = "$stamp_head" ] && [ "$stamp_rev $stamp_hash" = "$want" ]; then
    exit 0
  fi
  if [ -n "$dirty" ] || [ "$head" != "$stamp_head" ]; then
    echo "core/upstream/ にパッチへ書き出していない変更があります。" >&2
    echo "残すなら scripts/export-core-patches.sh で core/patches/ に書き出し、捨てるなら core/upstream/ を消してから、もう一度実行してください。" >&2
    exit 1
  fi
elif [ -n "$head" ]; then
  echo "core/upstream/ が scripts/prepare-core.sh で作ったものではありません。core/upstream/ を消してから、もう一度実行してください。" >&2
  exit 1
fi

if ! git -C "$UPSTREAM" cat-file -e "$REV^{commit}" 2>/dev/null; then
  git -C "$UPSTREAM" fetch -q --depth 1 origin "$REV"
fi
git -C "$UPSTREAM" checkout -q -f --detach "$REV"
git -C "$UPSTREAM" clean -q -fdx
if ! git -C "$UPSTREAM" -c user.name=retroboy-snap -c user.email=retroboy-snap@localhost \
    am -q --committer-date-is-author-date "${patches[@]}"; then
  git -C "$UPSTREAM" am --abort || true
  echo "core/patches/ のパッチが本家 $REV に当たりませんでした。" >&2
  exit 1
fi

echo "$want $(git -C "$UPSTREAM" rev-parse HEAD)" > "$STAMP"
echo "core/upstream/ を本家 ${REV:0:7} ＋パッチ ${#patches[@]} 本にしました。"
