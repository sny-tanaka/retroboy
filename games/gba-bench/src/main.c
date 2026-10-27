// GBA の重さを測るデモ（内蔵ソフト「GBA ベンチ」）。エミュレーターに重い仕事を一通りさせる:
// - スプライト 128 個が跳ね回る（半分は回転・拡大のスプライト。行あたりの上限にも当たる）
// - モード 1: 文字の背景 2 枚（1 枚は HBlank の DMA で 1 行ずつ横にゆらす）＋回転・拡大の背景 1 枚
//   モード 2: 回転・拡大の背景 2 枚
// - 音を鳴らし続ける: Direct Sound A（タイマー 0 と DMA1 で 18157Hz の 8 ビットの音を CPU で毎フレーム混ぜる）と
//   PSG（矩形波 2 つ・ノイズ）
// - ゲーム内セーブ（SRAM）に起動の回数を書く（アプリのゲーム内セーブの試し）
//
// 操作: 方向 = 文字の背景を動かす / A = 音のオンとオフ / B = スプライトの 128 個と 0 個 / L・R = 回転の速さ /
//       START = モード 1 とモード 2 / SELECT = 横ゆれのオンとオフ。押しているボタンは画面の下に明るく出る。
// libc は使わない（clang --target=arm-none-eabi -ffreestanding。Makefile）。割り算も使わない（ライブラリが要るため）。
#include "font.h"
#include "sin.h"

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed char s8;
typedef int s32;

#define REG16(addr) (*(volatile u16*) (addr))
#define REG32(addr) (*(volatile u32*) (addr))

#define DISPCNT REG16(0x04000000)
#define DISPSTAT REG16(0x04000004)
#define BGCNT(n) REG16(0x04000008 + (n) * 2)
#define BGHOFS(n) REG16(0x04000010 + (n) * 4)
#define BGVOFS(n) REG16(0x04000012 + (n) * 4)
#define BG2PA REG16(0x04000020)
#define BG2PB REG16(0x04000022)
#define BG2PC REG16(0x04000024)
#define BG2PD REG16(0x04000026)
#define BG2X REG32(0x04000028)
#define BG2Y REG32(0x0400002C)
#define BG3PA REG16(0x04000030)
#define BG3PB REG16(0x04000032)
#define BG3PC REG16(0x04000034)
#define BG3PD REG16(0x04000036)
#define BG3X REG32(0x04000038)
#define BG3Y REG32(0x0400003C)
#define SOUND1CNT_L REG16(0x04000060)
#define SOUND1CNT_H REG16(0x04000062)
#define SOUND1CNT_X REG16(0x04000064)
#define SOUND2CNT_L REG16(0x04000068)
#define SOUND2CNT_H REG16(0x0400006C)
#define SOUND4CNT_L REG16(0x04000078)
#define SOUND4CNT_H REG16(0x0400007C)
#define SOUNDCNT_L REG16(0x04000080)
#define SOUNDCNT_H REG16(0x04000082)
#define SOUNDCNT_X REG16(0x04000084)
#define FIFO_A 0x040000A0
#define DMA0SAD REG32(0x040000B0)
#define DMA0DAD REG32(0x040000B4)
#define DMA0CNT_L REG16(0x040000B8)
#define DMA0CNT_H REG16(0x040000BA)
#define DMA1SAD REG32(0x040000BC)
#define DMA1DAD REG32(0x040000C0)
#define DMA1CNT_H REG16(0x040000C6)
#define DMA3SAD REG32(0x040000D4)
#define DMA3DAD REG32(0x040000D8)
#define DMA3CNT REG32(0x040000DC)
#define TM0CNT_L REG16(0x04000100)
#define TM0CNT_H REG16(0x04000102)
#define KEYINPUT REG16(0x04000130)
#define IE REG16(0x04000200)
#define IME REG16(0x04000208)

#define PAL_BG ((volatile u16*) 0x05000000)
#define PAL_OBJ ((volatile u16*) 0x05000200)
#define VRAM ((volatile u16*) 0x06000000)
#define OAM ((volatile u32*) 0x07000000)
#define SRAM ((volatile u8*) 0x0E000000)

// VRAM の置き場所
#define CHAR_TEXT 0 // 4bpp の文字と縞（BG0・BG1）
#define CHAR_AFFINE 1 // 8bpp の回転の背景の絵（BG2・BG3）
#define SCREEN_TEXT 28 // BG0 の地図（文字）
#define SCREEN_STRIPE 29 // BG1 の地図（縞）
#define SCREEN_AFFINE2 30 // BG2 の地図（32x32 の 1 バイトずつ）
#define SCREEN_AFFINE3 31 // BG3 の地図
#define TILE_STRIPE 48 // 縞の絵の最初のタイル（文字のタイルのあと）

#define SPRITES 128
#define SAMPLES_PER_FRAME 304 // 18157Hz × 1 フレーム（280896 サイクル = 924 × 304）
#define WAVE_LENGTH 512 // 横ゆれの表（256 ＋ 画面の 160 行より長く）

#define KEY_A 0x001
#define KEY_B 0x002
#define KEY_SELECT 0x004
#define KEY_START 0x008
#define KEY_RIGHT 0x010
#define KEY_LEFT 0x020
#define KEY_UP 0x040
#define KEY_DOWN 0x080
#define KEY_R 0x100
#define KEY_L 0x200

// 「セーブの種類は SRAM」の印（エミュレーターはこの文字を見てセーブの種類を決めることがある）
__attribute__((used)) static const char SAVE_TYPE[] = "SRAM_V113";
static const u8 SAVE_MAGIC[4] = { 'G', 'B', 'N', 'C' };

// clang が構造体の写しなどに使うことがあるので用意する
void* memcpy(void* dest, const void* src, unsigned n) {
    u8* d = dest;
    const u8* s = src;
    while (n--) *d++ = *s++;
    return dest;
}
void* memset(void* dest, int value, unsigned n) {
    u8* d = dest;
    while (n--) *d++ = (u8) value;
    return dest;
}
void __aeabi_memcpy(void* dest, const void* src, unsigned n) { memcpy(dest, src, n); }
void __aeabi_memcpy4(void* dest, const void* src, unsigned n) { memcpy(dest, src, n); }
void __aeabi_memset(void* dest, unsigned n, int value) { memset(dest, value, n); }
void __aeabi_memclr(void* dest, unsigned n) { memset(dest, 0, n); }
void __aeabi_memclr4(void* dest, unsigned n) { memset(dest, 0, n); }

static inline s32 sin4096(u32 angle) { return SIN[angle & 255]; }
static inline s32 cos4096(u32 angle) { return SIN[(angle + 64) & 255]; }

static inline void vblank_wait(void) { __asm__ volatile("swi 0x05" ::: "r0", "r1", "r2", "r3", "memory"); }

static u32 random_state = 0x2545F491;
static u32 random_next(void) {
    random_state ^= random_state << 13;
    random_state ^= random_state >> 17;
    random_state ^= random_state << 5;
    return random_state;
}

// ---- 文字 ----

static volatile u16* text_map(void) { return VRAM + SCREEN_TEXT * 0x400; }

// palette: 0 = ふつう（白）、1 = 押している（黄）、2 = 押していない（暗い）
static void put_text(int x, int y, const char* text, int palette) {
    volatile u16* map = text_map() + y * 32 + x;
    while (*text) *map++ = (u16) (font_tile(*text++) | (palette << 12));
}

static void put_number(int x, int y, u32 value, int digits) {
    char buffer[11];
    buffer[digits] = 0;
    // 決まった桁数の 10 進。割り算を使わず、引き算で 1 桁ずつ求める
    static const u32 POW10[10] = { 1000000000, 100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10, 1 };
    // 桁からあふれる分は捨てる
    while (digits < 10 && value >= POW10[9 - digits]) value -= POW10[9 - digits];
    for (int i = 0; i < digits; ++i) {
        u32 place = POW10[10 - digits + i];
        char c = '0';
        while (value >= place) {
            value -= place;
            ++c;
        }
        buffer[i] = c;
    }
    put_text(x, y, buffer, 0);
}

// ---- 絵を用意する ----

static void load_font(void) {
    volatile u16* tiles = VRAM + CHAR_TEXT * 0x2000;
    for (int g = 0; g < FONT_GLYPHS; ++g) {
        for (int row = 0; row < 8; ++row) {
            u8 bits = row < 7 ? FONT[g][row] : 0;
            // 4bpp: 1 ドット 4 ビット、左のドットが下位。5 ドットの字を 1 ドット右にずらして置き、
            // 字の無いドットは暗い地（色 2）にする（スプライトや背景の上でも読めるように）
            u32 line = 0;
            for (int col = 0; col < 8; ++col) {
                int on = col >= 1 && col <= 5 && (bits & (0x10 >> (col - 1)));
                line |= (on ? 1u : 2u) << (col * 4);
            }
            tiles[(g + 1) * 16 + row * 2] = (u16) line;
            tiles[(g + 1) * 16 + row * 2 + 1] = (u16) (line >> 16);
        }
    }
}

static void load_stripes(void) {
    volatile u16* tiles = VRAM + CHAR_TEXT * 0x2000 + TILE_STRIPE * 16;
    // 4 枚: 斜めの縞の 4 つの位置。色は 1〜3、0 は透明（下の回転の背景が見える）
    for (int t = 0; t < 4; ++t) {
        for (int y = 0; y < 8; ++y) {
            u32 line = 0;
            for (int x = 0; x < 8; ++x) {
                int d = (x + y + t * 8) & 31;
                u32 color = d < 4 ? 1 : d < 6 ? 2 : d < 7 ? 3 : 0;
                line |= color << (x * 4);
            }
            tiles[t * 16 + y * 2] = (u16) line;
            tiles[t * 16 + y * 2 + 1] = (u16) (line >> 16);
        }
    }
    volatile u16* map = VRAM + SCREEN_STRIPE * 0x400;
    for (int y = 0; y < 32; ++y) {
        for (int x = 0; x < 32; ++x) {
            map[y * 32 + x] = (u16) ((TILE_STRIPE + ((x + y) & 3)) | (1 << 12));
        }
    }
}

static void load_affine(void) {
    // 8bpp のタイル 8 枚: 色の段（32 から）で塗った市松の模様
    volatile u16* tiles = VRAM + CHAR_AFFINE * 0x2000;
    for (int t = 0; t < 8; ++t) {
        for (int y = 0; y < 8; ++y) {
            for (int x = 0; x < 8; x += 2) {
                u32 a = 32 + t * 24 + ((x ^ y) & 7) * 2;
                u32 b = 32 + t * 24 + (((x + 1) ^ y) & 7) * 2;
                if (x == 0 || y == 0) a = 16; // タイルの縁の線
                tiles[t * 32 + y * 4 + x / 2] = (u16) (a | (b << 8));
            }
        }
    }
    // 地図（1 マス 1 バイト。VRAM は 16 ビットで書くので 2 マスずつ）
    volatile u16* map2 = VRAM + SCREEN_AFFINE2 * 0x400;
    volatile u16* map3 = VRAM + SCREEN_AFFINE3 * 0x400;
    for (int y = 0; y < 32; ++y) {
        for (int x = 0; x < 32; x += 2) {
            u32 a = ((x >> 2) + (y >> 2)) & 7;
            u32 b = (((x + 1) >> 2) + (y >> 2)) & 7;
            map2[(y * 32 + x) / 2] = (u16) (a | (b << 8));
            u32 c = (x ^ y) & 7;
            u32 d = ((x + 1) ^ y) & 7;
            map3[(y * 32 + x) / 2] = (u16) (c | (d << 8));
        }
    }
}

static u16 rgb(u32 r, u32 g, u32 b) { return (u16) ((r & 31) | ((g & 31) << 5) | ((b & 31) << 10)); }

static void load_palettes(void) {
    PAL_BG[0] = rgb(3, 2, 6); // 地の色（暗い紫）
    PAL_BG[1] = rgb(31, 31, 31); // 文字
    PAL_BG[2] = rgb(2, 1, 5); // 字の地
    PAL_BG[16 + 1] = rgb(20, 14, 30); // 縞
    PAL_BG[16 + 2] = rgb(14, 9, 24);
    PAL_BG[16 + 3] = rgb(9, 6, 16);
    PAL_BG[32 + 1] = rgb(31, 28, 8); // 押しているボタン
    PAL_BG[32 + 2] = rgb(2, 1, 5);
    PAL_BG[48 + 1] = rgb(12, 11, 17); // 押していないボタン
    PAL_BG[48 + 2] = rgb(2, 1, 5);
    PAL_BG[16] = rgb(2, 2, 4);
    // 回転の背景の色の段（32〜223）
    for (int i = 0; i < 192; ++i) {
        u32 t = (u32) i >> 3;
        PAL_BG[32 + i] = rgb(4 + (t & 7) * 2 + (i & 7), 6 + (t >> 1), 12 + (i & 7) * 2);
    }
    // スプライトの色（16 色の組を 16 組。色相を変える）
    for (int p = 0; p < 16; ++p) {
        u32 r = (u32) (sin4096((u32) p * 16) + 4096) >> 8;
        u32 g = (u32) (sin4096((u32) p * 16 + 85) + 4096) >> 8;
        u32 b = (u32) (sin4096((u32) p * 16 + 170) + 4096) >> 8;
        PAL_OBJ[p * 16 + 1] = rgb(r, g, b);
        PAL_OBJ[p * 16 + 2] = rgb(r >> 1, g >> 1, b >> 1);
        PAL_OBJ[p * 16 + 3] = rgb(31, 31, 31);
    }
}

static void load_sprite_tiles(void) {
    // 16x16 の 4bpp（1D の並び）。タイル 0〜3 は玉、4〜7 は矢印（回転が見えるように）
    volatile u16* tiles = (volatile u16*) 0x06010000;
    for (int shape = 0; shape < 2; ++shape) {
        for (int y = 0; y < 16; ++y) {
            for (int x = 0; x < 16; x += 4) {
                u32 value = 0;
                for (int k = 0; k < 4; ++k) {
                    int px = x + k;
                    int dx = px * 2 - 15;
                    int dy = y * 2 - 15;
                    u32 color;
                    if (shape == 0) {
                        int d = dx * dx + dy * dy;
                        color = d < 60 ? 3 : d < 150 ? 1 : d < 225 ? 2 : 0;
                    } else {
                        int ax = dx < 0 ? -dx : dx;
                        color = (dy < -2 && ax < (dy + 16)) ? 1 : (dy >= -2 && ax < 5) ? 2 : 0;
                        if (color && ax < 2) color = 3;
                    }
                    value |= color << (k * 4);
                }
                int tile = shape * 4 + (y >> 3) * 2 + (x >> 3);
                tiles[tile * 16 + (y & 7) * 2 + ((x & 7) >> 2)] = (u16) value;
            }
        }
    }
}

// ---- スプライト ----

struct Sprite {
    s32 x, y; // 8 ビットの小数つき
    s32 vx, vy;
};
static struct Sprite sprites[SPRITES];
static u32 oam_buffer[256]; // 128 個 × 8 バイト（回転の行列は 4 個ごとの 4 つめの値）

static void init_sprites(void) {
    for (int i = 0; i < SPRITES; ++i) {
        sprites[i].x = (s32) (random_next() & 0xDFFF); // 0〜224 × 256
        sprites[i].y = (s32) (random_next() & 0x8FFF); // 0〜143 × 256
        sprites[i].vx = (s32) (random_next() & 0x1FF) - 0x100;
        sprites[i].vy = (s32) (random_next() & 0x1FF) - 0x100;
        if (sprites[i].vx == 0) sprites[i].vx = 0x80;
    }
}

static void update_sprites(int visible, u32 frame) {
    u16* oam = (u16*) oam_buffer;
    for (int i = 0; i < SPRITES; ++i) {
        struct Sprite* s = &sprites[i];
        s->x += s->vx;
        s->y += s->vy;
        if (s->x < 0) {
            s->x = 0;
            s->vx = -s->vx;
        } else if (s->x > 224 << 8) {
            s->x = 224 << 8;
            s->vx = -s->vx;
        }
        if (s->y < 0) {
            s->y = 0;
            s->vy = -s->vy;
        } else if (s->y > 144 << 8) {
            s->y = 144 << 8;
            s->vy = -s->vy;
        }
        u16 attr0 = (u16) ((s->y >> 8) & 0xFF);
        u16 attr1 = (u16) (((s->x >> 8) & 0x1FF) | (1 << 14)); // 16x16
        u16 attr2 = (u16) ((1 << 10) | ((i & 15) << 12)); // 優先度 1・色の組
        if (i & 1) {
            // 回転・拡大のスプライト（行列は 32 個を順に使う）
            attr0 |= 1 << 8;
            attr1 |= (u16) (((i >> 1) & 31) << 9);
            attr2 |= 4; // 矢印
        }
        if (!visible) attr0 = (u16) (attr0 & ~(1 << 8)) | (1 << 9); // 隠す
        oam[i * 4 + 0] = attr0;
        oam[i * 4 + 1] = attr1;
        oam[i * 4 + 2] = attr2;
    }
    // 回転の行列 32 個
    for (int m = 0; m < 32; ++m) {
        u32 angle = frame * (u32) (1 + (m & 3)) + (u32) m * 8;
        s32 scale = 256 + (sin4096(frame * 2 + (u32) m * 16) >> 5); // 128〜384 で拡大・縮小
        s32 c = (cos4096(angle) * scale) >> 12;
        s32 sn = (sin4096(angle) * scale) >> 12;
        oam[(m * 4 + 0) * 4 + 3] = (u16) c;
        oam[(m * 4 + 1) * 4 + 3] = (u16) -sn;
        oam[(m * 4 + 2) * 4 + 3] = (u16) sn;
        oam[(m * 4 + 3) * 4 + 3] = (u16) c;
    }
}

// ---- 音 ----

static s8 mix_buffer[2][SAMPLES_PER_FRAME] __attribute__((aligned(4)));
static int mix_current;
static u32 pad_phase[2];
static const u32 PAD_INCREMENT[4][2] = {
    { 26020070, 39030104 }, // A2 と E3
    { 20652839, 30979258 }, // F2 と C3
    { 30942594, 46413890 }, // C3 と G3
    { 23181516, 34772275 }, // G2 と D3
};
static const u16 MELODY[16] = { 1750, 1798, 1825, 1849, 1881, 1849, 1825, 1798, 1750, 1714, 1750, 1798, 1825, 1798, 1750, 0 };
static const u16 BASS[4] = { 856, 547, 1046, 711 };

static void init_sound(void) {
    SOUNDCNT_X = 0x80; // 音を使う
    SOUNDCNT_L = 0xBB77; // PSG: 左右とも音量 7、矩形波 1・2 とノイズを左右に
    // PSG 100%・Direct Sound A 100% を左右に・タイマー 0・FIFO A を空に
    SOUNDCNT_H = 0x0002 | 0x0004 | 0x0300 | 0x0800;
    SOUND1CNT_L = 0x0008; // スイープなし
    TM0CNT_L = (u16) (65536 - 924);
    TM0CNT_H = 0x0080;
}

static void sound_vblank(int enabled) {
    // 前のフレームに混ぜた音を流し始める（1 フレーム分でちょうど終わる）
    DMA1CNT_H = 0;
    if (!enabled) return;
    DMA1SAD = (u32) mix_buffer[mix_current];
    DMA1DAD = FIFO_A;
    DMA1CNT_H = 0xB640; // 使う・FIFO の合図で・32 ビット・くり返し・送り先は固定
    mix_current ^= 1;
}

static void sound_frame(u32 frame, int enabled) {
    u32 chord = (frame >> 7) & 3;
    if (!enabled) {
        SOUNDCNT_L = 0x0077;
        return;
    }
    SOUNDCNT_L = 0xBB77;
    // Direct Sound: 2 つの sin を CPU で足して 8 ビットにする（毎フレーム 304 サンプル）
    s8* out = mix_buffer[mix_current];
    u32 a = pad_phase[0];
    u32 b = pad_phase[1];
    u32 ia = PAD_INCREMENT[chord][0];
    u32 ib = PAD_INCREMENT[chord][1];
    s32 swell = 24 + (sin4096(frame) >> 9); // 16〜32 で音量がゆれる
    for (int i = 0; i < SAMPLES_PER_FRAME; ++i) {
        s32 v = (sin4096(a >> 24) + (sin4096(b >> 24) >> 1)) * swell >> 12;
        out[i] = (s8) v;
        a += ia;
        b += ib;
    }
    pad_phase[0] = a;
    pad_phase[1] = b;
    // PSG: 8 フレームごとに旋律（矩形波 2）、32 フレームごとにベース（矩形波 1）、16 フレームごとにノイズ
    if ((frame & 7) == 0) {
        u16 note = MELODY[(frame >> 3) & 15];
        if (note) {
            SOUND2CNT_L = 0x8380 | 0x0040; // 音量 8 から下がっていく・デューティ 50%
            SOUND2CNT_H = (u16) (note | 0x8000);
        }
    }
    if ((frame & 31) == 0) {
        SOUND1CNT_H = 0x6580 | 0x0080; // 音量 6 からゆっくり下がる・デューティ 50%
        SOUND1CNT_X = (u16) (BASS[chord] | 0x8000);
    }
    if ((frame & 15) == 8) {
        SOUND4CNT_L = 0x3100; // 音量 3 からすぐ下がる
        SOUND4CNT_H = 0x8021;
    }
}

// ---- ゲーム内セーブ（SRAM は 8 ビットで読み書きする） ----

static u32 count_boot(void) {
    int valid = 1;
    for (int i = 0; i < 4; ++i) {
        if (SRAM[i] != SAVE_MAGIC[i]) valid = 0;
    }
    u32 count = valid ? (u32) SRAM[4] | ((u32) SRAM[5] << 8) : 0;
    count = (count + 1) & 0xFFFF;
    for (int i = 0; i < 4; ++i) SRAM[i] = SAVE_MAGIC[i];
    SRAM[4] = (u8) count;
    SRAM[5] = (u8) (count >> 8);
    return count;
}

// ---- 横ゆれ（HBlank の DMA で BG1 の横の位置を 1 行ずつ変える） ----

static u16 wave[WAVE_LENGTH];

static void init_wave(void) {
    for (int i = 0; i < WAVE_LENGTH; ++i) wave[i] = (u16) (sin4096((u32) i * 3) >> 9);
}

static void wave_vblank(int enabled, u32 frame, u32 scroll_x) {
    DMA0CNT_H = 0;
    if (!enabled) {
        BGHOFS(1) = (u16) scroll_x;
        return;
    }
    // ゆれの表は毎フレーム 1 段ずらして使う。横の位置は表の値を足したものにするため、表を書き換えずに
    // 先頭の行だけここで入れ、残りの行は DMA が HBlank ごとに入れる
    u32 start = frame & 255;
    for (int i = 0; i < 161; ++i) wave[256 + i] = (u16) (wave[(start + i) & 255] + scroll_x);
    BGHOFS(1) = wave[256];
    DMA0SAD = (u32) &wave[257];
    DMA0DAD = 0x04000014; // BG1HOFS
    DMA0CNT_L = 1;
    DMA0CNT_H = 0xA000 | 0x0200 | 0x0040; // 使う・HBlank で・くり返し・送り先は固定（毎フレーム始め直す）
}

// ---- 画面 ----

static const char* const BUTTON_LABELS[10] = { "A", "B", "SE", "ST", "RI", "LE", "UP", "DO", "R", "L" };
static const u8 BUTTON_X[10] = { 27, 25, 13, 16, 7, 1, 4, 10, 22, 19 };

static void draw_static_text(void) {
    put_text(1, 1, "GBA BENCH", 0);
    put_text(1, 3, "FRAME", 0);
    put_text(1, 4, "BOOT", 0);
    put_text(1, 5, "OBJ", 0);
    put_text(1, 6, "SOUND", 0);
    put_text(1, 7, "SPIN", 0);
    put_text(1, 8, "WAVE", 0);
}

static void draw_status(u32 frame, int mode, int sprites_on, int sound_on, int spin, int wave_on, u16 keys) {
    put_text(12, 1, mode == 1 ? "MODE 1" : "MODE 2", 0);
    put_number(7, 3, frame, 6);
    put_text(7, 5, sprites_on ? "128" : "  0", 0);
    put_text(7, 6, sound_on ? "ON " : "OFF", 0);
    put_number(7, 7, (u32) spin, 1);
    put_text(7, 8, wave_on ? "ON " : "OFF", 0);
    for (int b = 0; b < 10; ++b) put_text(BUTTON_X[b], 18, BUTTON_LABELS[b], (keys >> b) & 1 ? 2 : 3);
}

int main(void) {
    DISPCNT = 0x0080; // 準備の間は画面を消す
    load_palettes();
    load_font();
    load_stripes();
    load_affine();
    load_sprite_tiles();
    init_wave();
    init_sprites();
    init_sound();

    BGCNT(0) = (u16) (0 | (CHAR_TEXT << 2) | (SCREEN_TEXT << 8)); // 優先度 0
    BGCNT(1) = (u16) (2 | (CHAR_TEXT << 2) | (SCREEN_STRIPE << 8)); // 優先度 2
    BGCNT(2) = (u16) (3 | (CHAR_AFFINE << 2) | (1 << 7) | (SCREEN_AFFINE2 << 8) | (1 << 13)); // 優先度 3・8bpp・繰り返し
    BGCNT(3) = (u16) (2 | (CHAR_AFFINE << 2) | (1 << 7) | (SCREEN_AFFINE3 << 8) | (1 << 13));

    u32 boots = count_boot();
    draw_static_text();
    put_number(7, 4, boots, 5);

    DISPSTAT = 0x0008; // VBlank の割り込み
    IE = 0x0001;
    IME = 1;

    u32 frame = 0;
    int mode = 1;
    int sprites_on = 1;
    int sound_on = 1;
    int wave_on = 1;
    int spin = 2;
    u16 previous = 0;
    s32 scroll_x = 0;
    s32 scroll_y = 0;
    u32 angle2 = 0;
    u32 angle3 = 0;

    for (;;) {
        vblank_wait();

        // VBlank の間にする: スプライト・背景の位置・音の DMA・横ゆれの DMA
        DMA3SAD = (u32) oam_buffer;
        DMA3DAD = (u32) OAM;
        DMA3CNT = 256 | 0x84000000u; // 32 ビット × 256
        sound_vblank(sound_on);
        wave_vblank(mode == 1 && wave_on, frame, (u32) scroll_x);
        BGVOFS(1) = (u16) scroll_y;
        DISPCNT = mode == 1 ? (u16) (1 | 0x0100 | 0x0200 | 0x0400 | 0x1000 | 0x0040)
                            : (u16) (2 | 0x0400 | 0x0800 | 0x1000 | 0x0040);

        // 回転・拡大の背景: 画面の真ん中を軸に回す
        s32 zoom2 = 256 + (sin4096(frame) >> 5);
        s32 c2 = (cos4096(angle2 >> 4) * zoom2) >> 12;
        s32 s2 = (sin4096(angle2 >> 4) * zoom2) >> 12;
        BG2PA = (u16) c2;
        BG2PB = (u16) -s2;
        BG2PC = (u16) s2;
        BG2PD = (u16) c2;
        BG2X = (u32) ((128 << 8) - (120 * c2 - 80 * s2));
        BG2Y = (u32) ((128 << 8) - (120 * s2 + 80 * c2));
        s32 c3 = cos4096(angle3 >> 4);
        s32 s3 = sin4096(angle3 >> 4);
        BG3PA = (u16) (c3 >> 4);
        BG3PB = (u16) (-s3 >> 4);
        BG3PC = (u16) (s3 >> 4);
        BG3PD = (u16) (c3 >> 4);
        BG3X = (u32) ((64 << 8) - ((120 * c3 - 80 * s3) >> 4));
        BG3Y = (u32) ((64 << 8) - ((120 * s3 + 80 * c3) >> 4));

        // ボタン（押したら 0 になる）
        u16 keys = (u16) (~KEYINPUT & 0x03FF);
        u16 pressed = (u16) (keys & ~previous);
        previous = keys;
        if (pressed & KEY_A) sound_on = !sound_on;
        if (pressed & KEY_B) sprites_on = !sprites_on;
        if (pressed & KEY_START) mode = mode == 1 ? 2 : 1;
        if (pressed & KEY_SELECT) wave_on = !wave_on;
        if ((pressed & KEY_L) && spin > 0) --spin;
        if ((pressed & KEY_R) && spin < 9) ++spin;
        if (keys & KEY_LEFT) scroll_x -= 2;
        if (keys & KEY_RIGHT) scroll_x += 2;
        if (keys & KEY_UP) scroll_y -= 2;
        if (keys & KEY_DOWN) scroll_y += 2;
        scroll_x &= 0x1FF;
        scroll_y &= 0x1FF;
        angle2 += (u32) spin * 3;
        angle3 -= (u32) spin * 2;

        update_sprites(sprites_on, frame);
        sound_frame(frame, sound_on);
        draw_status(frame, mode, sprites_on, sound_on, spin, wave_on, keys);
        ++frame;
    }
}
