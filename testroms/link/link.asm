; 通信ケーブルのテスト ROM（GB / GBC 両用）。scripts/build-testroms.sh で隣の linktest.gb を作る（ROM もコミットする）。
;
; ボタン:
;   A = 親機（内部クロック）で送り続ける   B = 子機（外部クロック）で受け続ける
;   上 = AUTO（子機で待ち、しばらく来なければ親機を試す。ゲームによくある役の決め方）
;   下 = 止める   SELECT = 高速クロック（GBC のみ）   START = CPU の倍速モード（GBC のみ）
;
; 送るバイトの並び（両方の端末が、受け取った値が合っているかを確かめられる）:
;   親機は最初に $01 を送り、そのあとは「直前に受け取った値 + 1」を送る。
;   子機は最初に $5A を返し、そのあとは「直前に受け取った値 xor $A5」を返す。
;   つまり親機の k 回目の送信を m(k)、子機の返事を s(k) とすると
;   m(0) = $01, s(0) = $5A, m(k+1) = s(k) + 1, s(k+1) = m(k) xor $A5。
;   core/tests/link.rs も同じ式で、2 台の間を流れたバイトを確かめる。
;
; 画面: SENT / RECV = 最後に送った・受け取ったバイト（16 進）、OK / ERR = 並びが合った・合わなかった数、
;   TOUT = 子機で 30 フレーム（0.5 秒）受け取れなかった回数、BPS = 直前の 60 フレームで受け渡したバイト数。

DEF rP1   EQU $FF00
DEF rSB   EQU $FF01
DEF rSC   EQU $FF02
DEF rDIV  EQU $FF04
DEF rIF   EQU $FF0F
DEF rLCDC EQU $FF40
DEF rLY   EQU $FF44
DEF rBGP  EQU $FF47
DEF rKEY1 EQU $FF4D
DEF rVBK  EQU $FF4F
DEF rBCPS EQU $FF68
DEF rBCPD EQU $FF69
DEF rIE   EQU $FFFF

DEF MODE_IDLE   EQU 0
DEF MODE_MASTER EQU 1
DEF MODE_SLAVE  EQU 2
DEF MODE_LISTEN EQU 3 ; AUTO: 子機で待っている
DEF MODE_PROBE  EQU 4 ; AUTO: 親機を試している

DEF FIRST_MASTER_BYTE EQU $01
DEF FIRST_SLAVE_BYTE  EQU $5A
DEF SLAVE_XOR         EQU $A5
DEF SLAVE_TIMEOUT_FRAMES EQU 30

; ボタンの bit（ReadJoypad の結果。押されていると 1）
DEF PAD_A      EQU 0
DEF PAD_B      EQU 1
DEF PAD_SELECT EQU 2
DEF PAD_START  EQU 3
DEF PAD_RIGHT  EQU 4
DEF PAD_LEFT   EQU 5
DEF PAD_UP     EQU 6
DEF PAD_DOWN   EQU 7

; 文字とタイルの番号（Font の並び）
CHARMAP " ", 0
CHARMAP "0", 1
CHARMAP "1", 2
CHARMAP "2", 3
CHARMAP "3", 4
CHARMAP "4", 5
CHARMAP "5", 6
CHARMAP "6", 7
CHARMAP "7", 8
CHARMAP "8", 9
CHARMAP "9", 10
CHARMAP "A", 11
CHARMAP "B", 12
CHARMAP "C", 13
CHARMAP "D", 14
CHARMAP "E", 15
CHARMAP "F", 16
CHARMAP "G", 17
CHARMAP "H", 18
CHARMAP "I", 19
CHARMAP "J", 20
CHARMAP "K", 21
CHARMAP "L", 22
CHARMAP "M", 23
CHARMAP "N", 24
CHARMAP "O", 25
CHARMAP "P", 26
CHARMAP "Q", 27
CHARMAP "R", 28
CHARMAP "S", 29
CHARMAP "T", 30
CHARMAP "U", 31
CHARMAP "V", 32
CHARMAP "W", 33
CHARMAP "X", 34
CHARMAP "Y", 35
CHARMAP "Z", 36
CHARMAP ":", 37
CHARMAP "-", 38
CHARMAP ".", 39
CHARMAP "/", 40
DEF TILE_DIGIT0 EQU 1
DEF TILE_HEX_A  EQU 11

; 画面の位置
MACRO SCREEN_AT ; 行, 列
    DEF \1_VRAM EQU $9800 + (\2) * 32 + (\3)
ENDM
    SCREEN_AT FIELD_MODE, 2, 6
    SCREEN_AT FIELD_CLK, 3, 6
    SCREEN_AT FIELD_SPD, 4, 6
    SCREEN_AT FIELD_SENT, 6, 6
    SCREEN_AT FIELD_RECV, 7, 6
    SCREEN_AT FIELD_OK, 8, 6
    SCREEN_AT FIELD_ERR, 9, 6
    SCREEN_AT FIELD_TOUT, 10, 6
    SCREEN_AT FIELD_BPS, 11, 6

; 受け渡しの続きは割り込みの中ですぐ行う（子機は次のバイトの用意をすぐ済ませないと、親機の次の転送に
; 間に合わない。フレームごとの画面の処理は長いので、その後に回すと高速クロックで間に合わない）
SECTION "Serial interrupt", ROM0[$58]
    jp SerialInterrupt

SECTION "Header", ROM0[$100]
    nop
    jp Start
    ds $150 - @, 0

SECTION "Main", ROM0[$150]
Start:
    di
    ld sp, $E000
    cp $11
    ld a, 0
    jr nz, .notCgb
    inc a
.notCgb:
    ld [wIsCgb], a

    call WaitVBlank
    xor a
    ldh [rLCDC], a

    call LoadFont
    call ClearScreen
    call DrawLabels
    call SetPalettes
    call InitVariables

    ld a, $91
    ldh [rLCDC], a
    xor a
    ldh [rIF], a
    ld a, $08
    ldh [rIE], a
    ei

; VBlank に入ったら 1 回だけ OnVBlank を呼ぶ（割り込みの処理で LY = 144 の行を見逃さないよう、144 以上で見る）
MainLoop:
    ldh a, [rLY]
    cp 144
    jr nc, .inVBlank
    xor a
    ld [wInVBlank], a
    jr MainLoop
.inVBlank:
    ld a, [wInVBlank]
    and a
    jr nz, MainLoop
    inc a
    ld [wInVBlank], a
    call OnVBlank
    jr MainLoop

; ---- 通信 ----

SerialInterrupt:
    push af
    push bc
    push de
    push hl
    call OnSerialDone
    pop hl
    pop de
    pop bc
    pop af
    reti

; 親機として a を送り始める
StartMaster:
    ld [wLastSent], a
    ldh [rSB], a
    ld a, [wClockFast]
    add a
    or $81
    ldh [rSC], a
    ret

; 子機として a を返す用意をする
ArmSlave:
    ld [wLastSent], a
    ldh [rSB], a
    ld a, $80
    ldh [rSC], a
    ret

; 転送を止め、止める前に終わっていた転送の割り込みも捨てる（割り込みを止めた中で呼ぶ）
CancelTransfer:
    xor a
    ldh [rSC], a
    ldh a, [rIF]
    res 3, a
    ldh [rIF], a
    ret

OnSerialDone:
    ldh a, [rSB]
    ld [wLastRecv], a
    ld a, [wMode]
    cp MODE_MASTER
    jr z, .master
    cp MODE_SLAVE
    jr z, .slave
    cp MODE_PROBE
    jr z, .probe
    cp MODE_LISTEN
    jr z, .listen
    ret

.probe:
    ld a, [wLastRecv]
    cp FIRST_SLAVE_BYTE
    jr nz, .probeFailed
    ld a, MODE_MASTER
    ld [wMode], a
    call DrawModeField
    jr .master
.probeFailed:
    jp EnterListen

.listen:
    ld a, MODE_SLAVE
    ld [wMode], a
    call DrawModeField
    jr .slave

.master:
    ; 受け取った値の確かめ: 最初は $5A、そのあとは 1 つ前に送った値 xor $A5
    ld a, [wFirst]
    and a
    ld a, FIRST_SLAVE_BYTE
    jr nz, .masterCheck
    ld a, [wPrevSent]
    xor SLAVE_XOR
.masterCheck:
    ld b, a
    ld a, [wLastRecv]
    cp b
    call CountResult
    xor a
    ld [wFirst], a
    ld a, [wLastSent]
    ld [wPrevSent], a
    ; 子機が次の用意をする間を空ける（Pan Docs: 親機は転送ごとに少し待つ）
    ld b, 128
.gap:
    dec b
    jr nz, .gap
    ld a, [wLastRecv]
    inc a
    jp StartMaster

.slave:
    ; 受け取った値の確かめ: 最初は $01、そのあとは 1 つ前に返した値 + 1
    ld a, [wFirst]
    and a
    ld a, FIRST_MASTER_BYTE
    jr nz, .slaveCheck
    ld a, [wPrevSent]
    inc a
.slaveCheck:
    ld b, a
    ld a, [wLastRecv]
    cp b
    call CountResult
    xor a
    ld [wFirst], a
    ld [wSlaveIdleFrames], a
    ld a, [wLastSent]
    ld [wPrevSent], a
    ld a, [wLastRecv]
    xor SLAVE_XOR
    jp ArmSlave

; z なら OK、nz なら ERR を 1 増やす。どちらでも、この 1 秒に受け渡した数を 1 増やす
CountResult:
    ld hl, wOk
    jr z, .inc
    ld hl, wErr
.inc:
    call Inc16
    ld hl, wCountThisSecond
    jp Inc16

; ---- モード ----

EnterIdle:
    call CancelTransfer
    ld a, MODE_IDLE
    ld [wMode], a
    jp DrawModeField

EnterMaster:
    call ResetCounters
    ld a, MODE_MASTER
    ld [wMode], a
    call DrawModeField
    ld a, FIRST_MASTER_BYTE
    jp StartMaster

EnterSlave:
    call ResetCounters
    ld a, MODE_SLAVE
    ld [wMode], a
    call DrawModeField
    ld a, FIRST_SLAVE_BYTE
    jp ArmSlave

EnterAuto:
    call ResetCounters
    ; fallthrough
EnterListen:
    call CancelTransfer
    ld a, 1
    ld [wFirst], a
    ld a, MODE_LISTEN
    ld [wMode], a
    call DrawModeField
    ; 待つ長さは 16〜47 フレームのどれか（両方が同時に親機を試し続けないよう、DIV で散らす）
    ldh a, [rDIV]
    and 31
    add 16
    ld [wAutoTimer], a
    ld a, FIRST_SLAVE_BYTE
    jp ArmSlave

EnterProbe:
    call CancelTransfer
    ld a, 1
    ld [wFirst], a
    ld a, MODE_PROBE
    ld [wMode], a
    call DrawModeField
    ld a, FIRST_MASTER_BYTE
    jp StartMaster

; いまのモードを始めからやり直す（クロックや速さを変えたとき）
RestartMode:
    ld a, [wMode]
    cp MODE_MASTER
    jp z, EnterMaster
    cp MODE_SLAVE
    jp z, EnterSlave
    cp MODE_IDLE
    jp z, EnterIdle
    jp EnterAuto

ResetCounters:
    call CancelTransfer
    xor a
    ld hl, wOk
    ld b, 10 ; wOk, wErr, wTout, wBps, wCountThisSecond
.clear:
    ld [hl+], a
    dec b
    jr nz, .clear
    ld [wSlaveIdleFrames], a
    ld [wFrameInSecond], a
    ld a, 1
    ld [wFirst], a
    ret

ToggleClock:
    ld a, [wIsCgb]
    and a
    ret z
    ld a, [wClockFast]
    xor 1
    ld [wClockFast], a
    call DrawClockField
    jp RestartMode

ToggleSpeed:
    ld a, [wIsCgb]
    and a
    ret z
    call CancelTransfer
    ld a, $30
    ldh [rP1], a
    ld a, 1
    ldh [rKEY1], a
    stop
    xor a
    ldh [rIF], a
    ld a, [wDoubleSpeed]
    xor 1
    ld [wDoubleSpeed], a
    call DrawSpeedField
    jp RestartMode

; ---- 1 フレームごと ----

; モードの切り替えと数の更新は、割り込み（OnSerialDone）と同じ変数を触るので、割り込みを止めて行う。
; 止める間は短くする（子機は止めている間に届いたバイトの続きができず、親機の次の転送に間に合わなくなる）。
; 画面への書き写しと、数を文字にする FormatFields は、割り込みを止めずに行う
OnVBlank:
    call CopyFields
    call ReadJoypad
    ld b, a
    ld a, [wPrevPad]
    cpl
    and b
    ld [wPressed], a
    ld a, b
    ld [wPrevPad], a

    ld a, [wPressed]
    and a
    jr z, .noPress
    di
    ; 呼んだ先がレジスタを壊すので、毎回 wPressed から読み直す
    MACRO ON_PRESS ; ボタン, 呼ぶところ
        ld a, [wPressed]
        bit \1, a
        call nz, \2
    ENDM
    ON_PRESS PAD_A, EnterMaster
    ON_PRESS PAD_B, EnterSlave
    ON_PRESS PAD_UP, EnterAuto
    ON_PRESS PAD_DOWN, EnterIdle
    ON_PRESS PAD_SELECT, ToggleClock
    ON_PRESS PAD_START, ToggleSpeed
    ei
.noPress:

    di
    ; 1 秒（60 フレーム）ごとに BPS を更新
    ld hl, wFrameInSecond
    inc [hl]
    ld a, [hl]
    cp 60
    jr c, .noSecond
    xor a
    ld [hl], a
    ld a, [wCountThisSecond]
    ld [wBps], a
    ld a, [wCountThisSecond + 1]
    ld [wBps + 1], a
    xor a
    ld [wCountThisSecond], a
    ld [wCountThisSecond + 1], a
.noSecond:

    ld a, [wMode]
    cp MODE_SLAVE
    jr z, .slaveTimeout
    cp MODE_LISTEN
    jr z, .listenTimer
    jr .format

.slaveTimeout:
    ld a, [wFirst]
    and a
    jr nz, .format
    ld hl, wSlaveIdleFrames
    inc [hl]
    ld a, [hl]
    cp SLAVE_TIMEOUT_FRAMES
    jr c, .format
    xor a
    ld [hl], a
    ld hl, wTout
    call Inc16
    jr .format

.listenTimer:
    ld hl, wAutoTimer
    dec [hl]
    call z, EnterProbe

.format:
    ei
    jp FormatFields

ReadJoypad:
    ld a, $20
    ldh [rP1], a
    ldh a, [rP1]
    ldh a, [rP1]
    cpl
    and $0F
    swap a
    ld b, a
    ld a, $10
    ldh [rP1], a
    ldh a, [rP1]
    ldh a, [rP1]
    ldh a, [rP1]
    ldh a, [rP1]
    cpl
    and $0F
    or b
    ld b, a
    ld a, $30
    ldh [rP1], a
    ld a, b
    ret

; ---- 画面 ----

; wFields の中身を VRAM の各欄に写す（VBlank の中で呼ぶ）
CopyFields:
    ld hl, FieldTable
    ld de, wFields
.next:
    ld a, [hl+]
    ld c, a
    ld a, [hl+]
    ld b, a ; bc = VRAM
    or c
    ret z
    ld a, [hl+] ; 長さ
    push hl
    ld l, c
    ld h, b
    ld b, a
.copy:
    ld a, [de]
    inc de
    ld [hl+], a
    dec b
    jr nz, .copy
    pop hl
    jr .next

DEF FIELD_MODE_LEN EQU 6
DEF FIELD_CLK_LEN  EQU 6
DEF FIELD_SPD_LEN  EQU 2
FieldTable:
    dw FIELD_MODE_VRAM
    db FIELD_MODE_LEN
    dw FIELD_CLK_VRAM
    db FIELD_CLK_LEN
    dw FIELD_SPD_VRAM
    db FIELD_SPD_LEN
    dw FIELD_SENT_VRAM
    db 2
    dw FIELD_RECV_VRAM
    db 2
    dw FIELD_OK_VRAM
    db 5
    dw FIELD_ERR_VRAM
    db 5
    dw FIELD_TOUT_VRAM
    db 5
    dw FIELD_BPS_VRAM
    db 5
    dw 0

FormatFields:
    ld a, [wLastSent]
    ld hl, wFieldSent
    call FormatHex
    ld a, [wLastRecv]
    ld hl, wFieldRecv
    call FormatHex
    ld de, wOk
    ld hl, wFieldOk
    call FormatDec
    ld de, wErr
    ld hl, wFieldErr
    call FormatDec
    ld de, wTout
    ld hl, wFieldTout
    call FormatDec
    ld de, wBps
    ld hl, wFieldBps
    jp FormatDec

; a を 16 進 2 桁にして [hl] に書く
FormatHex:
    ld b, a
    swap a
    call HexDigit
    ld [hl+], a
    ld a, b
    call HexDigit
    ld [hl], a
    ret

HexDigit:
    and $0F
    cp 10
    jr c, .digit
    add TILE_HEX_A - 10
    ret
.digit:
    add TILE_DIGIT0
    ret

; [de]（16 ビット、下位が先）を 10 進 5 桁にして [hl] に書く
FormatDec:
    ld a, [de]
    ld c, a
    inc de
    ld a, [de]
    ld b, a ; bc = 値
    ld de, -10000
    call .digit
    ld de, -1000
    call .digit
    ld de, -100
    call .digit
    ld de, -10
    call .digit
    ld a, c
    add TILE_DIGIT0
    ld [hl], a
    ret
.digit:
    ld a, TILE_DIGIT0 - 1
.loop:
    inc a
    push hl
    ld h, b
    ld l, c
    add hl, de
    ld b, h
    ld c, l
    pop hl
    jr c, .loop
    ; 引きすぎた分を戻す
    push af
    push hl
    ld h, b
    ld l, c
    ld a, e
    cpl
    ld e, a
    ld a, d
    cpl
    ld d, a
    inc de
    add hl, de
    ld b, h
    ld c, l
    pop hl
    pop af
    ld [hl+], a
    ret

DrawModeField:
    ld a, [wMode]
    ld hl, ModeNames
    ld b, 0
    ld c, a
    add a ; ×6
    add c
    add a
    ld c, a
    add hl, bc
    ld de, wFieldMode
    ld b, FIELD_MODE_LEN
    jp CopyBytes

DrawClockField:
    ld a, [wClockFast]
    and a
    ld hl, ClockNormal
    jr z, .copy
    ld hl, ClockFast
.copy:
    ld de, wFieldClk
    ld b, FIELD_CLK_LEN
    jp CopyBytes

DrawSpeedField:
    ld a, [wDoubleSpeed]
    and a
    ld hl, Speed1x
    jr z, .copy
    ld hl, Speed2x
.copy:
    ld de, wFieldSpd
    ld b, FIELD_SPD_LEN
    jp CopyBytes

; hl から de へ b バイト
CopyBytes:
    ld a, [hl+]
    ld [de], a
    inc de
    dec b
    jr nz, CopyBytes
    ret

ModeNames:
    db "IDLE  "
    db "MASTER"
    db "SLAVE "
    db "AUTO  "
    db "AUTO-M"
ClockNormal:
    db "NORMAL"
ClockFast:
    db "FAST  "
Speed1x:
    db "1X"
Speed2x:
    db "2X"

; [hl] の 16 ビット（下位が先）を 1 増やす
Inc16:
    inc [hl]
    ret nz
    inc hl
    inc [hl]
    ret

WaitVBlank:
    ldh a, [rLY]
    cp 144
    jr nz, WaitVBlank
    ret

LoadFont:
    ld hl, Font
    ld de, $8000
    ld bc, FontEnd - Font
.loop:
    ld a, [hl+]
    ld [de], a
    inc de
    ld [de], a
    inc de
    dec bc
    ld a, b
    or c
    jr nz, .loop
    ret

ClearScreen:
    ld a, [wIsCgb]
    and a
    jr z, .bank0
    ld a, 1
    ldh [rVBK], a
    call .clear
    xor a
    ldh [rVBK], a
.bank0:
.clear:
    ld hl, $9800
    ld bc, $400
.loop:
    xor a
    ld [hl+], a
    dec bc
    ld a, b
    or c
    jr nz, .loop
    ret

DrawLabels:
    ld hl, Labels
.next:
    ld a, [hl+]
    ld e, a
    ld a, [hl+]
    ld d, a
    or e
    ret z
.char:
    ld a, [hl+]
    cp $FF
    jr z, .next
    ld [de], a
    inc de
    jr .char

MACRO TEXT ; 行, 列, 文字列
    dw $9800 + (\1) * 32 + (\2)
    db \3, $FF
ENDM
Labels:
    TEXT 0, 0, "LINK TEST"
    TEXT 2, 0, "MODE:"
    TEXT 3, 0, "CLK :"
    TEXT 4, 0, "SPD :"
    TEXT 6, 0, "SENT:"
    TEXT 7, 0, "RECV:"
    TEXT 8, 0, "OK  :"
    TEXT 9, 0, "ERR :"
    TEXT 10, 0, "TOUT:"
    TEXT 11, 0, "BPS :"
    TEXT 13, 0, "A:MASTER  B:SLAVE"
    TEXT 14, 0, "UP:AUTO  DOWN:STOP"
    TEXT 15, 0, "SEL:CLK  START:SPD"
    TEXT 16, 0, "CLK/SPD: GBC ONLY"
    dw 0

SetPalettes:
    ld a, $E4
    ldh [rBGP], a
    ld a, [wIsCgb]
    and a
    ret z
    ld a, $80
    ldh [rBCPS], a
    ld hl, CgbPalette
    ld b, 8
.loop:
    ld a, [hl+]
    ldh [rBCPD], a
    dec b
    jr nz, .loop
    ret

CgbPalette:
    dw $7FFF, $5294, $294A, $0000

InitVariables:
    xor a
    ld [wInVBlank], a
    ld [wMode], a
    ld [wClockFast], a
    ld [wDoubleSpeed], a
    ld [wLastSent], a
    ld [wLastRecv], a
    ld [wPrevSent], a
    ld [wPrevPad], a
    ld [wAutoTimer], a
    call ResetCounters
    call DrawModeField
    call DrawClockField
    call DrawSpeedField
    call FormatFields
    jp CopyFields

; 1 ビット 8x8 の字（LoadFont が 2 ビットに広げる。色 3 で描く）
Font:
    db $00,$00,$00,$00,$00,$00,$00,$00 ; space
    db $3C,$66,$6E,$76,$66,$66,$3C,$00 ; 0
    db $18,$38,$18,$18,$18,$18,$7E,$00 ; 1
    db $3C,$66,$06,$0C,$30,$60,$7E,$00 ; 2
    db $3C,$66,$06,$1C,$06,$66,$3C,$00 ; 3
    db $0C,$1C,$3C,$6C,$7E,$0C,$0C,$00 ; 4
    db $7E,$60,$7C,$06,$06,$66,$3C,$00 ; 5
    db $3C,$60,$7C,$66,$66,$66,$3C,$00 ; 6
    db $7E,$06,$0C,$18,$30,$30,$30,$00 ; 7
    db $3C,$66,$66,$3C,$66,$66,$3C,$00 ; 8
    db $3C,$66,$66,$3E,$06,$0C,$38,$00 ; 9
    db $18,$3C,$66,$66,$7E,$66,$66,$00 ; A
    db $7C,$66,$66,$7C,$66,$66,$7C,$00 ; B
    db $3C,$66,$60,$60,$60,$66,$3C,$00 ; C
    db $78,$6C,$66,$66,$66,$6C,$78,$00 ; D
    db $7E,$60,$60,$7C,$60,$60,$7E,$00 ; E
    db $7E,$60,$60,$7C,$60,$60,$60,$00 ; F
    db $3C,$66,$60,$6E,$66,$66,$3E,$00 ; G
    db $66,$66,$66,$7E,$66,$66,$66,$00 ; H
    db $7E,$18,$18,$18,$18,$18,$7E,$00 ; I
    db $3E,$0C,$0C,$0C,$0C,$6C,$38,$00 ; J
    db $66,$6C,$78,$70,$78,$6C,$66,$00 ; K
    db $60,$60,$60,$60,$60,$60,$7E,$00 ; L
    db $63,$77,$7F,$6B,$63,$63,$63,$00 ; M
    db $66,$76,$7E,$7E,$6E,$66,$66,$00 ; N
    db $3C,$66,$66,$66,$66,$66,$3C,$00 ; O
    db $7C,$66,$66,$7C,$60,$60,$60,$00 ; P
    db $3C,$66,$66,$66,$6A,$6C,$36,$00 ; Q
    db $7C,$66,$66,$7C,$78,$6C,$66,$00 ; R
    db $3C,$66,$60,$3C,$06,$66,$3C,$00 ; S
    db $7E,$18,$18,$18,$18,$18,$18,$00 ; T
    db $66,$66,$66,$66,$66,$66,$3C,$00 ; U
    db $66,$66,$66,$66,$66,$3C,$18,$00 ; V
    db $63,$63,$63,$6B,$7F,$77,$63,$00 ; W
    db $66,$66,$3C,$18,$3C,$66,$66,$00 ; X
    db $66,$66,$66,$3C,$18,$18,$18,$00 ; Y
    db $7E,$06,$0C,$18,$30,$60,$7E,$00 ; Z
    db $00,$18,$18,$00,$18,$18,$00,$00 ; :
    db $00,$00,$00,$7E,$00,$00,$00,$00 ; -
    db $00,$00,$00,$00,$00,$18,$18,$00 ; .
    db $06,$0C,$18,$30,$60,$C0,$00,$00 ; /
FontEnd:

SECTION "Variables", WRAM0
wIsCgb: db
wInVBlank: db
wMode: db
wClockFast: db
wDoubleSpeed: db
wFirst: db
wLastSent: db
wLastRecv: db
wPrevSent: db
wPrevPad: db
wPressed: db
wAutoTimer: db
wSlaveIdleFrames: db
wFrameInSecond: db
; ResetCounters がまとめて 0 にする（並びを変えない）
wOk: dw
wErr: dw
wTout: dw
wBps: dw
wCountThisSecond: dw
; CopyFields が FieldTable の順に VRAM へ写す（並びを変えない）
wFields:
wFieldMode: ds FIELD_MODE_LEN
wFieldClk: ds FIELD_CLK_LEN
wFieldSpd: ds FIELD_SPD_LEN
wFieldSent: ds 2
wFieldRecv: ds 2
wFieldOk: ds 5
wFieldErr: ds 5
wFieldTout: ds 5
wFieldBps: ds 5
