# GBA ベンチ

GBA を GB/GBC から移すかを決めるために、iPhone で mGBA（`app/src/gba/`）が等速で動くかを測る自作のデモ。
市販の GBA ROM はリポジトリにも配信にも入れないので、試すための ROM をこれで用意する。内蔵ソフトとして配信する（`game.json`）。

## 中身（エミュレーターにさせる重い仕事）

| もの | 内容 |
|---|---|
| スプライト | 16x16 を 128 個（OAM の全部）。半分は回転・拡大のスプライト（行列 32 個を毎フレーム書き換える）。重なって 1 行の上限にも当たる |
| 背景（モード 1） | 文字の背景 2 枚（文字・縞。縞は HBlank の DMA で 1 行ずつ横にゆらす）＋回転・拡大の背景 1 枚（8bpp） |
| 背景（モード 2） | 回転・拡大の背景 2 枚 |
| 音 | Direct Sound A（タイマー 0 ＋ DMA1 で 18157Hz。2 つの sin を CPU で毎フレーム 304 サンプル混ぜる）と PSG（矩形波 2 つ・ノイズ）を鳴らし続ける |
| ゲーム内セーブ | SRAM の先頭に起動の回数を書く（画面の BOOT。アプリのゲーム内セーブが残るかの試し） |
| 待ち | 毎フレーム VBlankIntrWait（BIOS の呼び出し）で待つ。市販のゲームと同じく、待つ間 CPU は止まる |

画面の左上に FRAME（進めたフレームの数）・BOOT・OBJ・SOUND・SPIN・WAVE、下の段に押しているボタンが明るく出る。

## 操作

| ボタン | 内容 |
|---|---|
| 方向 | 縞の背景を動かす |
| A | 音のオンとオフ |
| B | スプライトの 128 個と 0 個 |
| L / R | 回転の速さを下げる・上げる（SPIN 0〜9） |
| START | モード 1 とモード 2 |
| SELECT | 横ゆれのオンとオフ |

## ビルド

要るもの（macOS・Homebrew）:

```sh
brew install llvm lld
```

いまの ROM は Homebrew の llvm 23.1.4・lld 23.1.4 で作った。版が違うとできる ROM が変わり `scripts/build-games.sh --check` が止まるので、
版を変えたら ROM も作り直してコミットする。

```sh
./scripts/build-games.sh gba-bench   # games/gba-bench/gba-bench.gba を作る（中で make -C games/gba-bench OUT=...）
```

- C は `clang --target=arm-none-eabi -mcpu=arm7tdmi -mthumb -ffreestanding -nostdlib`（Thumb）、起動のコード `src/crt0.s` は ARM。
  libc も compiler-rt も使わない（割り算もしない）。リンクは `ld.lld` と `gba.ld`、ROM にするのは `llvm-objcopy -O binary`。
- ヘッダの検査の値は `tools/fixheader.py` が入れる。任天堂のロゴは入れない（エミュレーター用。実機で動かすなら gbafix などで入れる）。
- `src/sin.h` は python3 の `math.sin` から作った表（`round(sin(i * 2π / 256) * 4096)`）。`src/font.h` の字は手で描いた。

devkitARM や Butano・agb を使わなかったのは、要るものを増やさないため（llvm は Homebrew で入り、lld も同じ版がそろう）。
