// GBA の通信ケーブルのテスト（内蔵ソフト「GBA 通信テスト」）。ノーマルモード（8 ビット・32 ビット）で 2 台が
// 決まった並びを受け渡し、受け取った値が合っているかを数える（docs/link-cable-design.md 8.5）。
//
// 操作: A = 親機（内部クロック）で送り続ける / B = 子機（外部クロック）で受け続ける / 下 = 止める /
//       SELECT = 8 ビットと 32 ビット / START = 親機のクロック（256KHz と 2MHz）
//
// 並び（Game Boy の通信テスト testroms/link/link.asm と同じ式。8 ビットのときは下 8 ビットだけ）:
//   親機の j 回目の送信を m(j)、子機の返事を s(j) とすると
//   m(0) = 1, s(0) = 0x5A5A5A5A, m(j+1) = s(j) + 1, s(j+1) = m(j) xor 0xA5A5A5A5。
//   親機は s(j) = m(j-1) xor 0xA5A5A5A5 を、子機は m(j) = s(j-1) + 1 を確かめる。
// 用意の知らせ: 子機は受ける用意ができている間 SO を低く（SIOCNT の bit 3 = 0）し、ほかのときは高くする。
//   親機は SI（bit 2。相手の SO）が低いときだけ転送を始める（市販のゲームによくある手順）。
// 子機は割り込みの中で次の返事を用意する（親機の次の転送に間に合わせる）。親機は bit 7 を見て終わりを待ち、
// 転送のあいだに少し間を空ける。
//
// 画面: SI = いまの SI、SENT / RECV = 最後に送った・受け取った値（16 進）、OK / ERR = 並びが合った・合わなかった数、
//   TOUT = 子機で 30 フレーム（0.5 秒）受け取れなかった回数、BPS = 直前の 60 フレームで受け渡したバイトの数、
//   WAIT = 親機が SI を待ったフレームの数。
// libc は使わない（games/gba-bench と同じ。割り算もしない）。
#include "font.h"

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;

#define REG16(addr) (*(volatile u16*) (addr))

#define DISPCNT REG16(0x04000000)
#define DISPSTAT REG16(0x04000004)
#define BG0CNT REG16(0x04000008)
#define SIODATA32_LO REG16(0x04000120)
#define SIODATA32_HI REG16(0x04000122)
#define SIOCNT REG16(0x04000128)
#define SIODATA8 REG16(0x0400012A)
#define KEYINPUT REG16(0x04000130)
#define RCNT REG16(0x04000134)
#define IE REG16(0x04000200)
#define IME REG16(0x04000208)

#define PAL_BG ((volatile u16*) 0x05000000)
#define VRAM ((volatile u16*) 0x06000000)
#define SCREEN 28

#define KEY_A 0x001
#define KEY_B 0x002
#define KEY_SELECT 0x004
#define KEY_START 0x008
#define KEY_DOWN 0x080

// SIOCNT（ノーマルモード）
#define SIO_INTERNAL 0x0001
#define SIO_2MHZ 0x0002
#define SIO_SI 0x0004
#define SIO_SO_HIGH 0x0008
#define SIO_START 0x0080
#define SIO_32BIT 0x1000
#define SIO_IRQ 0x4000

#define IRQ_VBLANK 0x0001
#define IRQ_SIO 0x0080

#define FIRST_MASTER 0x00000001u
#define FIRST_SLAVE 0x5A5A5A5Au
#define SLAVE_XOR 0xA5A5A5A5u
#define SLAVE_TIMEOUT_FRAMES 30
// 親機が転送のあいだに空ける間（空回りの数）。子機が割り込みで次を用意するより長く
#define MASTER_GAP 64

enum { MODE_IDLE, MODE_MASTER, MODE_SLAVE };

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

static volatile int mode = MODE_IDLE;
static volatile int bits32 = 1;
static int fast_clock = 0;
static volatile u32 frames = 0;
// 数（割り込みと main の両方が書く）
static volatile u32 ok_count = 0;
static volatile u32 err_count = 0;
static volatile u32 tout_count = 0;
static volatile u32 wait_count = 0;
static volatile u32 bytes_count = 0;
static volatile u32 transfers = 0;
static volatile u32 last_sent = 0;
static volatile u32 prev_sent = 0;
static volatile u32 last_recv = 0;
static volatile u32 last_rx_frame = 0;
static u32 bps = 0;

static u32 mask(u32 value) { return bits32 ? value : (value & 0xFF); }
static u32 transfer_bytes(void) { return bits32 ? 4 : 1; }

static u32 read_data(void) { return bits32 ? (SIODATA32_LO | ((u32) SIODATA32_HI << 16)) : (SIODATA8 & 0xFF); }

static void write_data(u32 value) {
    if (bits32) {
        SIODATA32_LO = (u16) value;
        SIODATA32_HI = (u16) (value >> 16);
    } else {
        SIODATA8 = (u16) (value & 0xFF);
    }
}

static void check(int ok) {
    if (ok) {
        ++ok_count;
    } else {
        ++err_count;
    }
}

// ---- 子機（割り込みの中） ----

static u16 slave_cnt(void) { return (u16) (SIO_IRQ | (bits32 ? SIO_32BIT : 0)); }

static void slave_receive(void) {
    u32 received = read_data();
    // m(j) = s(j-1) + 1（最初は m(0) = 1）
    check(received == mask(transfers == 0 ? FIRST_MASTER : prev_sent + 1));
    last_recv = received;
    ++transfers;
    bytes_count += transfer_bytes();
    last_rx_frame = frames;
    // 次の返事 s(j+1) = m(j) xor 0xA5A5A5A5 を置いて、また受ける用意をする（SO は低いまま）
    u32 next = mask(received ^ SLAVE_XOR);
    write_data(next);
    prev_sent = last_sent;
    last_sent = next;
    SIOCNT = (u16) (slave_cnt() | SIO_START);
}

void irq_c(u32 flags) {
    if (flags & IRQ_VBLANK) ++frames;
    if ((flags & IRQ_SIO) && mode == MODE_SLAVE) slave_receive();
}

// ---- 役を替える ----

static void reset_counts(void) {
    ok_count = 0;
    err_count = 0;
    tout_count = 0;
    wait_count = 0;
    bytes_count = 0;
    transfers = 0;
    last_sent = 0;
    prev_sent = 0;
    last_recv = 0;
    bps = 0;
}

static u16 master_cnt(void) {
    return (u16) (SIO_INTERNAL | SIO_SO_HIGH | (fast_clock ? SIO_2MHZ : 0) | (bits32 ? SIO_32BIT : 0));
}

static void set_mode(int next) {
    IME = 0;
    mode = MODE_IDLE;
    // 止める（SO を高くして、相手に「受ける用意は無い」と知らせる）
    SIOCNT = (u16) (SIO_SO_HIGH | (bits32 ? SIO_32BIT : 0));
    reset_counts();
    if (next == MODE_SLAVE) {
        write_data(mask(FIRST_SLAVE));
        last_sent = mask(FIRST_SLAVE);
        last_rx_frame = frames;
        SIOCNT = (u16) (slave_cnt() | SIO_START);
    } else if (next == MODE_MASTER) {
        SIOCNT = master_cnt();
    }
    mode = next;
    IME = 1;
}

// ---- 親機（main の中） ----

static int master_busy = 0;

static void master_poll(void) {
    if (master_busy) {
        if (SIOCNT & SIO_START) return;
        master_busy = 0;
        u32 received = read_data();
        // s(j) = m(j-1) xor 0xA5A5A5A5（最初は s(0) = 0x5A5A5A5A）
        check(received == mask(transfers == 0 ? FIRST_SLAVE : prev_sent ^ SLAVE_XOR));
        last_recv = received;
        ++transfers;
        bytes_count += transfer_bytes();
        prev_sent = last_sent;
        last_sent = mask(received + 1);
        for (volatile int i = 0; i < MASTER_GAP; ++i) {
        }
        return;
    }
    // 子機の用意（SI が低い）を待つ
    if (SIOCNT & SIO_SI) return;
    if (transfers == 0) last_sent = mask(FIRST_MASTER);
    write_data(last_sent);
    SIOCNT = (u16) (master_cnt() | SIO_START);
    master_busy = 1;
}

// ---- 画面 ----

static void put_text(int x, int y, const char* text) {
    volatile u16* map = VRAM + SCREEN * 0x400 + y * 32 + x;
    while (*text) *map++ = font_tile(*text++);
}

static void put_hex(int x, int y, u32 value, int digits) {
    char buffer[9];
    for (int i = digits - 1; i >= 0; --i) {
        u32 nibble = value & 15;
        buffer[i] = (char) (nibble < 10 ? '0' + nibble : 'A' + nibble - 10);
        value >>= 4;
    }
    buffer[digits] = 0;
    put_text(x, y, buffer);
}

static void put_number(int x, int y, u32 value, int digits) {
    char buffer[11];
    static const u32 POW10[10] = { 1000000000, 100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10, 1 };
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
    buffer[digits] = 0;
    put_text(x, y, buffer);
}

static void load_font(void) {
    volatile u16* tiles = VRAM;
    for (int g = 0; g < FONT_GLYPHS; ++g) {
        for (int row = 0; row < 8; ++row) {
            u8 bits = row < 7 ? FONT[g][row] : 0;
            u32 line = 0;
            for (int col = 0; col < 8; ++col) {
                int on = col >= 1 && col <= 5 && (bits & (0x10 >> (col - 1)));
                line |= (on ? 1u : 0u) << (col * 4);
            }
            tiles[(g + 1) * 16 + row * 2] = (u16) line;
            tiles[(g + 1) * 16 + row * 2 + 1] = (u16) (line >> 16);
        }
    }
}

static void draw_static(void) {
    put_text(1, 1, "GBA LINK TEST");
    put_text(1, 3, "MODE");
    put_text(1, 4, "BITS");
    put_text(1, 5, "CLOCK");
    put_text(1, 6, "SI");
    put_text(1, 8, "SENT");
    put_text(1, 9, "RECV");
    put_text(1, 10, "OK");
    put_text(1, 11, "ERR");
    put_text(1, 12, "TOUT");
    put_text(1, 13, "BPS");
    put_text(1, 14, "WAIT");
    put_text(1, 16, "A:MASTER  B:SLAVE  DOWN:STOP");
    put_text(1, 17, "SELECT:BITS  START:CLOCK");
}

static void draw_values(void) {
    static const char* const MODE_NAMES[] = { "IDLE  ", "MASTER", "SLAVE " };
    put_text(7, 3, MODE_NAMES[mode]);
    put_text(7, 4, bits32 ? "32" : "8 ");
    put_text(7, 5, fast_clock ? "2M  " : "256K");
    put_number(7, 6, (SIOCNT & SIO_SI) ? 1 : 0, 1);
    put_hex(7, 8, last_sent, 8);
    put_hex(7, 9, last_recv, 8);
    put_number(7, 10, ok_count, 6);
    put_number(7, 11, err_count, 6);
    put_number(7, 12, tout_count, 6);
    put_number(7, 13, bps, 6);
    put_number(7, 14, wait_count, 6);
}

int main(void) {
    DISPCNT = 0x0080;
    PAL_BG[0] = 0x1000; // 濃い青
    PAL_BG[1] = 0x7FFF; // 白
    load_font();
    BG0CNT = (u16) (SCREEN << 8);
    draw_static();

    RCNT = 0; // ノーマルモード（bit 15 = 0）
    set_mode(MODE_IDLE);
    DISPSTAT = 0x0008; // VBlank の割り込み
    IE = IRQ_VBLANK | IRQ_SIO;
    IME = 1;
    DISPCNT = 0x0100; // モード 0・BG0

    u16 previous = 0;
    u32 seen_frame = 0;
    u32 bps_start_frame = 0;
    u32 bps_start_bytes = 0;
    for (;;) {
        if (mode == MODE_MASTER) master_poll();
        if (frames == seen_frame) continue;
        seen_frame = frames;

        u16 keys = (u16) (~KEYINPUT & 0x03FF);
        u16 pressed = (u16) (keys & ~previous);
        previous = keys;
        if (pressed & KEY_A) set_mode(MODE_MASTER);
        if (pressed & KEY_B) set_mode(MODE_SLAVE);
        if (pressed & KEY_DOWN) set_mode(MODE_IDLE);
        if (pressed & KEY_SELECT) {
            bits32 = !bits32;
            set_mode(mode);
        }
        if (pressed & KEY_START) {
            fast_clock = !fast_clock;
            set_mode(mode);
        }
        if (pressed & (KEY_A | KEY_B | KEY_DOWN | KEY_SELECT | KEY_START)) {
            master_busy = 0;
            bps_start_frame = seen_frame;
            bps_start_bytes = 0;
        }

        if (mode == MODE_MASTER && !master_busy && (SIOCNT & SIO_SI)) ++wait_count;
        if (mode == MODE_SLAVE && transfers > 0 && seen_frame - last_rx_frame >= SLAVE_TIMEOUT_FRAMES) {
            ++tout_count;
            last_rx_frame = seen_frame;
        }
        if (seen_frame - bps_start_frame >= 60) {
            bps = bytes_count - bps_start_bytes;
            bps_start_bytes = bytes_count;
            bps_start_frame = seen_frame;
        }
        draw_values();
    }
}
