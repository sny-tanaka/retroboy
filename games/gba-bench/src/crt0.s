@ GBA の起動のコード: ROM のヘッダ・スタック・.data の写し・.bss の 0 埋め・割り込みの受け口。
@ ヘッダのロゴは入れない（エミュレーター用。実機で動かすには gbafix などでロゴを入れる）。
@ 0xB2 の 0x96 と、ヘッダの検査の値（0xBD）は tools/fixheader.py が入れる。

    .section .header, "ax"
    .arm
    .global _start
_start:
    b       reset
    .fill   156, 1, 0               @ ロゴ（入れない）
    .ascii  "GBA BENCH   "          @ タイトル（12 文字）
    .ascii  "ZBNJ"                  @ ゲームの番号
    .ascii  "00"                    @ メーカー
    .byte   0x96                    @ 決まった値
    .byte   0x00                    @ 本体の種類
    .byte   0x00                    @ 機器の種類
    .fill   7, 1, 0
    .byte   0x00                    @ 版
    .byte   0x00                    @ ヘッダの検査の値（fixheader.py が入れる）
    .fill   2, 1, 0

reset:
    @ IRQ モードのスタック
    mov     r0, #0x12
    msr     cpsr_c, r0
    ldr     sp, =0x03007FA0
    @ System モードのスタック（main はここで動く）
    mov     r0, #0x1F
    msr     cpsr_c, r0
    ldr     sp, =0x03007F00

    @ .data を IWRAM に写す
    ldr     r0, =__data_load
    ldr     r1, =__data_start
    ldr     r2, =__data_end
1:  cmp     r1, r2
    ldrlo   r3, [r0], #4
    strlo   r3, [r1], #4
    blo     1b

    @ .bss を 0 にする
    ldr     r1, =__bss_start
    ldr     r2, =__bss_end
    mov     r3, #0
2:  cmp     r1, r2
    strlo   r3, [r1], #4
    blo     2b

    @ 割り込みの受け口を BIOS に教える
    ldr     r0, =0x03007FFC
    ldr     r1, =irq_handler
    str     r1, [r0]

    ldr     r0, =main
    mov     lr, pc
    bx      r0
3:  b       3b

@ 割り込み: 受けたものを IF に書いて消し、BIOS の VBlankIntrWait が待つ印（0x03007FF8）にも足す
    .arm
irq_handler:
    mov     r0, #0x04000000
    add     r0, r0, #0x200
    ldr     r1, [r0]                @ 下 16 ビットが IE、上 16 ビットが IF
    and     r1, r1, r1, lsr #16
    strh    r1, [r0, #2]
    ldr     r2, =0x03007FF8
    ldrh    r3, [r2]
    orr     r3, r3, r1
    strh    r3, [r2]
    bx      lr

    .pool
