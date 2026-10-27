#!/usr/bin/env bash
# 本家 Retro Boy を core/upstream.rev のコミットで core/upstream/ に取ってきて、core/patches/*.patch を
# git am で当てる（core/Cargo.toml はこの core/upstream/ を path 依存で使う）。core/upstream/ は git に入れない。
# 当て終えた状態（本家のコミット・パッチの中身・できたコミット）を core/upstream/.git/retroboy-snap-stamp に
# 覚え、変わっていなければ何もしない（ファイルを触らないので、Cargo が本家を作り直さない）。
# core/upstream/ にコミットしていない変更があれば、消さずに止まる。作業ツリーがきれいなら、前に当てた状態と
# 違っていても作り直す（前の HEAD は refs/retroboy-snap/previous-head に残す）。パッチを直す手順は README の
# 「本家のコードに手を入れる」。
# 引数に mgba を付けると、GBA のコアの mGBA で同じことをする（mgba/upstream.rev・mgba/patches/ → mgba/upstream/）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# どの本家か（引数。省くと Retro Boy）: retroboy = core/（smparsons/retroboy）、mgba = mgba/（mgba-emu/mgba。GBA のコア）
case "${1:-retroboy}" in
  retroboy) BASE="core"; REMOTE="https://github.com/smparsons/retroboy.git" ;;
  mgba) BASE="mgba"; REMOTE="https://github.com/mgba-emu/mgba.git" ;;
  *) echo "使い方: $0 [retroboy|mgba]" >&2; exit 1 ;;
esac
UPSTREAM="$ROOT/$BASE/upstream"
PATCH_DIR="$ROOT/$BASE/patches"
REV="$(tr -d '[:space:]' < "$ROOT/$BASE/upstream.rev")"
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

stamp_head=""
if [ -f "$STAMP" ]; then
  read -r stamp_rev stamp_hash stamp_head < "$STAMP"
  if [ -z "$dirty" ] && [ "$head" = "$stamp_head" ] && [ "$stamp_rev $stamp_hash" = "$want" ]; then
    exit 0
  fi
fi

if [ -n "$dirty" ]; then
  echo "$BASE/upstream/ にコミットしていない変更があります。" >&2
  echo "残すならコミットして scripts/export-core-patches.sh ${1:-retroboy} で $BASE/patches/ に書き出し、捨てるなら $BASE/upstream/ を消してから、もう一度実行してください。" >&2
  exit 1
fi

# 作業ツリーがきれいなら、印がずれていても（前の実行が途中で止まった・印が無い・パッチにしていないコミットがある）
# 作り直す。パッチにしていないコミットかもしれないので、前の HEAD は refs/retroboy-snap/previous-head に残して知らせる
if [ -n "$head" ] && [ "$head" != "$stamp_head" ] && [ "$head" != "$(git -C "$UPSTREAM" rev-parse -q --verify "$REV^{commit}" || true)" ]; then
  git -C "$UPSTREAM" update-ref refs/retroboy-snap/previous-head "$head"
  echo "$BASE/upstream/ の HEAD（${head:0:7}）が前に当てた状態と違うので、作り直します。" >&2
  echo "パッチにしていないコミットだったなら git -C $BASE/upstream log refs/retroboy-snap/previous-head で取り出せます。" >&2
fi

# 途中で止まっても前の印が残らないよう、当て直す前に消す（当て終えたら書き直す）
rm -f "$STAMP"

if ! git -C "$UPSTREAM" cat-file -e "$REV^{commit}" 2>/dev/null; then
  git -C "$UPSTREAM" fetch -q --depth 1 origin "$REV"
fi
git -C "$UPSTREAM" checkout -q -f --detach "$REV"
git -C "$UPSTREAM" clean -q -fdx
if ! git -C "$UPSTREAM" -c user.name=retroboy-snap -c user.email=retroboy-snap@localhost \
    am -q --committer-date-is-author-date "${patches[@]}"; then
  git -C "$UPSTREAM" am --abort || true
  echo "$BASE/patches/ のパッチが本家 $REV に当たりませんでした。" >&2
  exit 1
fi

echo "$want $(git -C "$UPSTREAM" rev-parse HEAD)" > "$STAMP"
echo "$BASE/upstream/ を本家 ${REV:0:7} ＋パッチ ${#patches[@]} 本にしました。"
