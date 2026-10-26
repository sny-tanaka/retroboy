#!/usr/bin/env bash
# アプリに内蔵する自作ゲーム（games/<id>/）の ROM をビルドする。決まりは docs/builtin-games.md。
#
# - games/<id>/Makefile があるゲームだけをビルドする。`make -C games/<id> OUT=<出力する ROM のパス>` を呼び、
#   できた ROM を game.json の "rom" の場所に置く（ROM はソースと一緒にリポジトリに入れる。アプリのビルドは
#   リポジトリの ROM を使うので、GBDK が無くても npm run check・デプロイはできる）。
# - Makefile が無いゲームは、ほかの方法で作る（game.json の "builtBy"。通信テストは scripts/build-testroms.sh）。
# - game.json の "toolchain" が "gbdk" のゲームは GBDK-2020 が要る（GBDK_HOME、既定は ~/.local/gbdk）。
#
# 使い方: scripts/build-games.sh [--check] [<id> ...]（id を省くと全部）
#   --check: ビルドし直した ROM が、リポジトリに入っている ROM と同じかだけを確かめる（書き換えない）。
#     npm run check が使う。要るツールが無いゲームは確かめずに飛ばす。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export GBDK_HOME="${GBDK_HOME:-$HOME/.local/gbdk}"

check=false
ids=()
for arg in "$@"; do
  case "$arg" in
    --check) check=true ;;
    *) ids+=("$arg") ;;
  esac
done

if [ "${#ids[@]}" -eq 0 ]; then
  for dir in "$ROOT"/games/*/; do
    if [ -f "$dir/game.json" ]; then
      ids+=("$(basename "$dir")")
    fi
  done
fi

# game.json の値（無ければ空）
field() {
  node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; console.log(v ?? "")' \
    "$1" "$2"
}

for id in ${ids[@]+"${ids[@]}"}; do
  dir="$ROOT/games/$id"
  if [ ! -f "$dir/game.json" ]; then
    echo "games/$id/game.json がありません。" >&2
    exit 1
  fi
  if [ ! -f "$dir/Makefile" ]; then
    echo "games/$id: Makefile が無いので飛ばします（作り方: $(field "$dir/game.json" builtBy)）。"
    continue
  fi
  if [ "$(field "$dir/game.json" toolchain)" = "gbdk" ] && [ ! -x "$GBDK_HOME/bin/lcc" ]; then
    if $check; then
      echo "GBDK が無いので、games/$id の ROM がソースと合っているかは確かめません（README の「必要なツール」）。"
      continue
    fi
    echo "GBDK が見つかりません（$GBDK_HOME/bin/lcc）。README の「必要なツール」を参照してください。" >&2
    exit 1
  fi

  rom="$dir/$(field "$dir/game.json" rom)"
  out="$dir/build/$(basename "$rom")"
  mkdir -p "$dir/build"
  rm -f "$out"
  make -C "$dir" OUT="$out"
  if [ ! -f "$out" ]; then
    echo "games/$id: make のあとに $out ができていません（Makefile は OUT= の場所に ROM を出すこと）。" >&2
    exit 1
  fi

  if $check; then
    if ! cmp -s "$out" "$rom"; then
      echo "games/$id の ROM（${rom#"$ROOT"/}）がソースから作ったものと違います。" >&2
      echo "scripts/build-games.sh $id で作り直して、ROM もコミットしてください。" >&2
      exit 1
    fi
    echo "games/$id: ROM はソースと合っています。"
  else
    cp "$out" "$rom"
    echo "${rom#"$ROOT"/} を作りました。"
  fi
done
