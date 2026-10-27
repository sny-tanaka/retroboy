"""GBA の ROM のヘッダの検査の値（0xBD）を入れる。使い方: python3 -I fixheader.py <ROM>

検査の値 = -(0xA0〜0xBC の和 + 0x19) の下位 8 ビット。ロゴ（0x04〜0x9F）は入れない（エミュレーター用）。
"""
import sys


def main() -> None:
    path = sys.argv[1]
    with open(path, "rb") as f:
        data = bytearray(f.read())
    data[0xBD] = (-(sum(data[0xA0:0xBD]) + 0x19)) & 0xFF
    with open(path, "wb") as f:
        f.write(data)


if __name__ == "__main__":
    main()
