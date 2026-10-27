// 通信ケーブルでつなぐコアの口。進みを合わせる部分（linkSession.ts）は、Game Boy（Retro Boy）と GBA（mGBA）の
// どちらのコアも、この形で扱う（docs/link-cable-design.md 8.3）。時刻はコアごとの通信用の時刻（Game Boy は
// 4MHz の T サイクル、GBA は 16.78MHz の CPU のサイクル）。
import {
    linkClock,
    linkDeliverReply,
    linkDeliverTransfer,
    linkSetConnected,
    linkStep,
    linkTakeEvent,
    releaseKey,
} from "../core/retroboyCore";

/** 相手の画面に出す機械の種類。GB と GBC はつなげる。GBA は GBA とだけ */
export type LinkSystem = "gb" | "cgb" | "gba";

/** 同じケーブルでつなげる機械どうしか */
export const sameLinkFamily = (a: LinkSystem, b: LinkSystem): boolean =>
    (a === "gba") === (b === "gba");

// step の戻り値（Game Boy は core/patches/0003、GBA は mgba/glue/mgba-glue.c の gba_link_step。同じ番号）
/** 音のバッファが 1 つできた（GBA は 1 フレーム進んで、その音ができた） */
export const STEP_AUDIO = 0;
/** 相手に送るものができた */
export const STEP_EVENT = 1;
/** 親機で、相手の返事を待っている */
export const STEP_WAITING_REPLY = 2;
/** 時刻が limit に着いた */
export const STEP_LIMIT = 3;

export type LinkCoreEvent =
    // 親機が転送を始めた。相手は at に受け取る。bits はビットの数（Game Boy は 8、GBA は 8 か 32）
    | {
          readonly kind: "transfer";
          readonly seq: number;
          readonly at: number;
          readonly data: number;
          readonly bits: number;
      }
    // 子機の返事
    | { readonly kind: "reply"; readonly seq: number; readonly data: number }
    // SO の高さが変わった（GBA のノーマルモード。相手の SI にする）
    | { readonly kind: "so"; readonly at: number; readonly level: number };

export interface LinkCore {
    /** 通信用の時刻の 1ms あたりの数 */
    readonly cyclesPerMs: number;
    /** 1 フレームの長さ（通信用の時刻で） */
    readonly frameCycles: number;
    /** つなぐ・切る。つなぐたびに時刻を 0 にし、途中の転送を捨てる */
    setConnected(connected: boolean): void;
    /** limit まで、または区切り（STEP_*）まで進める */
    step(limit: number): number;
    clock(): number;
    takeEvent(): LinkCoreEvent | null;
    deliverTransfer(seq: number, at: number, data: number, bits: number): void;
    deliverReply(seq: number, data: number): void;
    deliverSo(at: number, level: number): void;
    /** ボタンを離したことをコアに伝える（離すのを遅らせたあと） */
    releaseKey(key: string): void;
}

// Retro Boy の linkTakeEvent の種類
const RETROBOY_EVENT_TRANSFER = 0;

/** Game Boy・GBC のコア（Retro Boy に core/patches/ で足した口） */
export const retroboyLinkCore: LinkCore = {
    cyclesPerMs: 4194.304,
    // 倍速モードでも画面は同じ速さなので同じ
    frameCycles: 70224,
    setConnected: linkSetConnected,
    step: linkStep,
    clock: linkClock,
    takeEvent: () => {
        const event = linkTakeEvent();
        if (!event) return null;
        const [kind, seq, at, byte] = event;
        return kind === RETROBOY_EVENT_TRANSFER
            ? { kind: "transfer", seq, at, data: byte, bits: 8 }
            : { kind: "reply", seq, data: byte };
    },
    deliverTransfer: (seq, at, data) => linkDeliverTransfer(seq, at, data),
    deliverReply: linkDeliverReply,
    // Game Boy には SO の知らせが無い
    deliverSo: () => {},
    releaseKey,
};
