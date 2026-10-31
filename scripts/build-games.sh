#!/usr/bin/env bash
# アプリに内蔵する自作ゲーム（games/<id>/）の ROM をビルドする。決まりは docs/builtin-games.md。
#
# - games/<id>/Makefile があるゲームだけをビルドする。`make -C games/<id> OUT=<出力する ROM のパス>` を呼び、
#   できた ROM を game.json の "rom" の場所に置く（ROM はソースと一緒にリポジトリに入れる。アプリのビルドは
#   リポジトリの ROM を使うので、GBDK が無くても npm run check・デプロイはできる）。
# - Makefile が無いゲームは、ほかの方法で作る（game.json の "builtBy"。通信テストは scripts/build-testroms.sh）。
# - game.json の "toolchain" が "gbdk" のゲームは GBDK-2020 が要る（GBDK_HOME、既定は ~/.local/gbdk）。
# - "toolchain" が "llvm" のゲーム（GBA）は Homebrew の llvm（clang・llvm-objcopy）と lld（ld.lld）が要る。
# - "toolchain" が "agb" のゲーム（GBA。Rust の agb）は、上の llvm と lld に加えて、rustup で入れた
#   games/<id>/rust-toolchain.toml の nightly（rust-src つき）が要る（games/<id>/README.md。いまは agb のゲームのソースは
#   このリポジトリに無い。テイマーズライフは別のリポジトリで作る。docs/builtin-games.md の「ソースが別のリポジトリにあるゲーム」）。
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

# game.json の値（無ければ空）
field() {
  node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; console.log(v ?? "")' \
    "$1" "$2"
}

# id を指定しないときは全部。ただし "builtin": false のゲーム（内蔵ソフトから外したもの）は飛ばす
if [ "${#ids[@]}" -eq 0 ]; then
  for dir in "$ROOT"/games/*/; do
    if [ -f "$dir/game.json" ]; then
      if [ "$(field "$dir/game.json" builtin)" = "false" ]; then
        echo "games/$(basename "$dir"): 内蔵ソフトから外してある（\"builtin\": false）ので飛ばします。"
        continue
      fi
      ids+=("$(basename "$dir")")
    fi
  done
fi

# GBA の ROM を作る LLVM（games/<id>/Makefile と同じ場所を見る）
has_llvm() {
  command -v brew >/dev/null 2>&1 \
    && [ -x "$(brew --prefix llvm 2>/dev/null)/bin/clang" ] \
    && [ -x "$(brew --prefix lld 2>/dev/null)/bin/ld.lld" ]
}

# agb のゲーム: llvm・lld と、rust-toolchain.toml の nightly（rust-src つき）
has_agb() {
  local channel cargo
  channel="$(sed -n 's/^channel = "\(.*\)"/\1/p' "$1/rust-toolchain.toml" 2>/dev/null)"
  has_llvm && command -v rustup >/dev/null 2>&1 && [ -n "$channel" ] \
    && cargo="$(rustup which --toolchain "$channel" cargo 2>/dev/null)" \
    && [ -d "$(dirname "$cargo")/../lib/rustlib/src/rust" ]
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

  if [ "$(field "$dir/game.json" toolchain)" = "llvm" ] && ! has_llvm; then
    if $check; then
      echo "LLVM（clang・ld.lld）が無いので、games/$id の ROM がソースと合っているかは確かめません（README の「必要なツール」）。"
      continue
    fi
    echo "LLVM の clang か ld.lld が見つかりません。README の「必要なツール」を参照してください。" >&2
    exit 1
  fi

  if [ "$(field "$dir/game.json" toolchain)" = "agb" ] && ! has_agb "$dir"; then
    if $check; then
      echo "agb のビルドの道具（rustup の nightly・llvm・lld）が無いので、games/$id の ROM がソースと合っているかは確かめません（games/$id/README.md）。"
      continue
    fi
    echo "agb のビルドの道具（rustup の nightly と rust-src・llvm・lld）が見つかりません。games/$id/README.md を参照してください。" >&2
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
