#!/usr/bin/env bash
# GBA のコア（mGBA）を WASM にビルドし、app/src/gba/core/ に mgbaCore.js / mgbaCore.wasm（と型の mgbaCore.d.ts）を出力する。
#
# - 本家 mGBA は scripts/prepare-core.sh mgba が mgba/upstream/ に取ってきてパッチを当てる（版は mgba/upstream.rev）。
# - mGBA の CMake で GBA のコアだけの静的ライブラリ（libmgba.a）を作り、JS から呼ぶ口（mgba/glue/mgba-glue.c）と
#   一緒に Emscripten でリンクする。スレッドは使わない（SharedArrayBuffer も cross-origin isolation も要らない）。
# - Emscripten は emsdk の決まった版（EMSDK_VERSION）を使う。既定の置き場所は ~/.local/emsdk（環境変数 EMSDK で変えられる）。
#   入れ方は README の「必要なツール」。
# - 本家・パッチ・口・ビルドの設定が前と同じなら何もしない（mgba/build/stamp と出力の有無で見る）。
# 生成物は git に入れない（app/src/gba/core/ と mgba/build/ は .gitignore 済み）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EMSDK_VERSION="5.0.7"
EMSDK="${EMSDK:-$HOME/.local/emsdk}"
EMSCRIPTEN="$EMSDK/upstream/emscripten"
UPSTREAM="$ROOT/mgba/upstream"
BUILD="$ROOT/mgba/build"
OUT_DIR="$ROOT/app/src/gba/core"
GLUE="$ROOT/mgba/glue/mgba-glue.c"
TYPES="$ROOT/mgba/glue/mgbaCore.d.ts"

if [ ! -x "$EMSCRIPTEN/emcc" ]; then
  echo "Emscripten（emsdk $EMSDK_VERSION）が見つかりません（$EMSCRIPTEN/emcc）。README の「必要なツール」を参照してください。" >&2
  exit 1
fi
version="$("$EMSCRIPTEN/emcc" --version 2>/dev/null | head -1 | sed -E 's/.* ([0-9]+\.[0-9]+\.[0-9]+) .*/\1/')"
if [ "$version" != "$EMSDK_VERSION" ]; then
  echo "Emscripten の版が $version です。$EMSDK_VERSION にしてください（$EMSDK/emsdk install $EMSDK_VERSION && $EMSDK/emsdk activate $EMSDK_VERSION）。" >&2
  exit 1
fi
for tool in cmake ninja; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool が見つかりません。README の「必要なツール」を参照してください。" >&2
    exit 1
  fi
done
export PATH="$EMSCRIPTEN:$PATH"

"$ROOT/scripts/prepare-core.sh" mgba

# mGBA の機能のうち、GBA のコアに要らないもの（ほかのライブラリ・画面・スクリプト・GB のコア）は切る
CMAKE_FLAGS=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_POLICY_VERSION_MINIMUM=3.5
  -DLIBMGBA_ONLY=ON -DBUILD_STATIC=ON -DBUILD_SHARED=OFF
  -DM_CORE_GB=OFF -DM_CORE_GBA=ON
  -DENABLE_SCRIPTING=OFF
  -DUSE_ZLIB=OFF -DUSE_PNG=OFF -DUSE_LIBZIP=OFF -DUSE_MINIZIP=OFF -DUSE_LZMA=OFF -DUSE_SQLITE3=OFF -DUSE_ELF=OFF
  -DUSE_EPOXY=OFF -DUSE_FFMPEG=OFF -DUSE_EDITLINE=OFF -DUSE_DISCORD_RPC=OFF -DUSE_LUA=OFF
  -DBUILD_GL=OFF -DBUILD_GLES2=OFF -DBUILD_GLES3=OFF
)
# 口のコンパイルの設定は libmgba.a と合わせる（パッチの EMSCRIPTEN の分と、M_CORE_GBA・BUILD_STATIC）
GLUE_FLAGS=(
  -O3 -std=c11 -D_GNU_SOURCE -DDISABLE_THREADING -DM_CORE_GBA -DBUILD_STATIC
  -I"$UPSTREAM/include" -I"$BUILD/lib/include" -I"$UPSTREAM/src"
)
# - MODULARIZE・EXPORT_ES6: import して createMgbaCore() で作る（app/src/gba/gbaCore.ts）
# - FILESYSTEM=0: ファイルは使わない（ROM もセーブもメモリで渡す）
# - INCOMING_MODULE_JS_API: locateFile で WASM の URL を渡す（vite が付ける名前）
LINK_FLAGS=(
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createMgbaCore -sENVIRONMENT=web
  -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0
  -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32,HEAPF32
  -sINCOMING_MODULE_JS_API=locateFile
)

stamp="$EMSDK_VERSION $(git -C "$UPSTREAM" rev-parse HEAD) $(cat "$GLUE" "$TYPES" "${BASH_SOURCE[0]}" | shasum -a 256 | cut -d' ' -f1)"
if [ -f "$BUILD/stamp" ] && [ "$(cat "$BUILD/stamp")" = "$stamp" ] \
    && [ -f "$OUT_DIR/mgbaCore.js" ] && [ -f "$OUT_DIR/mgbaCore.wasm" ] && [ -f "$OUT_DIR/mgbaCore.d.ts" ]; then
  exit 0
fi

rm -rf "$BUILD"
mkdir -p "$BUILD/lib" "$OUT_DIR"
emcmake cmake -S "$UPSTREAM" -B "$BUILD/lib" "${CMAKE_FLAGS[@]}" > "$BUILD/cmake.log" 2>&1 || {
  cat "$BUILD/cmake.log" >&2
  exit 1
}
ninja -C "$BUILD/lib" mgba > "$BUILD/ninja.log" 2>&1 || {
  tail -50 "$BUILD/ninja.log" >&2
  exit 1
}
emcc "${GLUE_FLAGS[@]}" "$GLUE" "$BUILD/lib/libmgba.a" -o "$OUT_DIR/mgbaCore.js" "${LINK_FLAGS[@]}"
cp "$TYPES" "$OUT_DIR/mgbaCore.d.ts"
echo "$stamp" > "$BUILD/stamp"
echo "app/src/gba/core/ に mGBA（${version} の Emscripten）の WASM を作りました。"
