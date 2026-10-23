#!/usr/bin/env bash
# 人間が作ったアイコンの元画像（1254x1254、紺の角丸四角の外側に白い余白）から、
# PWA と iOS のホーム画面用のアイコンを作る。ImageMagick 7（magick）が要る。
#
# 使い方: ./scripts/make-icons.sh <元画像.png>
# 出力:   app/public/icons/ の PNG（生成物だが git に入れる）
#
# iOS は角を自分で丸めるので、白い余白が見えないよう全面を紺で塗った正方形にする。
#   1. 紺の角丸四角の外接正方形を切り出す（縁の 1〜2px のにじみを避けて少し内側で）。
#   2. 四隅に残る白（角丸の外側）を、それぞれの隅の近くの紺で塗りつぶす。
#   3. 各サイズに縮小する。maskable（Android などが円や角丸で切り抜く）は、
#      絵が安全領域（中央 80% の円）に収まるよう 72% に縮めて紺の余白をつける。
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "使い方: $0 <元画像.png>" >&2
    exit 1
fi

src="$1"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/app/public/icons"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$out"

# 紺の四角は x=73..1181, y=71..1180（magick "$src" -fuzz 10% -trim -format "%w %h %X %Y" info: で確かめた）。
# 縁から 4px 内側で 1100x1100 を切り出す。
magick "$src" -crop 1100x1100+77+75 +repage "$work/square.png"

# 四隅の白を紺で埋める。
#   - 四隅から白を塗りつぶしで透明にし、透明な部分を 3px 内側へ広げる
#     （白と紺の境目のにじみ＝中間色の線を残さないため）。
#   - 下に敷く紺は、四隅から 45° 方向に少し入った点の色を 4 隅に置いたグラデーション
#     （元の紺もゆるいグラデーションなので、単色で埋めるより継ぎ目が目立たない）。
size=1100
inset=90
last=$((size - 1))
far=$((last - inset))
pick() { magick "$work/square.png" -format "%[pixel:p{$1,$2}]" info:; }
c_tl="$(pick "$inset" "$inset")"
c_tr="$(pick "$far" "$inset")"
c_bl="$(pick "$inset" "$far")"
c_br="$(pick "$far" "$far")"

magick "$work/square.png" -alpha set -fuzz 35% -fill none \
    -draw "color 0,0 floodfill" \
    -draw "color $last,0 floodfill" \
    -draw "color 0,$last floodfill" \
    -draw "color $last,$last floodfill" \
    -channel A -morphology Erode Disk:3 +channel \
    "$work/cut.png"

magick \( xc:"$c_tl" xc:"$c_tr" +append \) \( xc:"$c_bl" xc:"$c_br" +append \) -append \
    -filter Triangle -resize "${size}x${size}!" "$work/bg.png"

magick "$work/bg.png" "$work/cut.png" -compose over -composite -alpha off "$work/square.png"

resize() {
    magick "$work/square.png" -filter Lanczos -resize "$1x$1" -strip -depth 8 -define png:color-type=2 "$2"
}
resize 512 "$out/icon-512.png"
resize 192 "$out/icon-192.png"
resize 180 "$out/apple-touch-icon.png"

# maskable: 72% に縮めて中央に置き、まわりを上と同じ紺のグラデーションで埋める。
# 縮めた絵の縁はぼかして、まわりの紺と継ぎ目が出ないようにする。
magick "$work/square.png" -filter Lanczos -resize 369x369 \
    \( -size 369x369 xc:black -fill white -draw "rectangle 24,24 344,344" -blur 0x12 \) \
    -alpha off -compose CopyOpacity -composite "$work/inner.png"
magick "$work/bg.png" -resize 512x512 "$work/inner.png" -gravity center -compose over -composite \
    -alpha off -strip -depth 8 -define png:color-type=2 "$out/icon-maskable-512.png"

echo "アイコンを $out に出力しました"
