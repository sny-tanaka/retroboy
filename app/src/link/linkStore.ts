// いまの通信ケーブルのつながり（LinkSession）を 1 つだけ持つ。音のループ（useAudioSync.ts）と画面
// （useLinkStatus）とゲームの状態（useRomSession.ts）が、ここから同じつながりを見る。
//
// いまは試験用に、URL の ?link=tab でだけつなぐ（同じブラウザのタブどうし。docs/link-cable-design.md 5 章）。
//   ?link=tab            … 同じ room の、もう 1 つのタブとつなぐ（room の既定は default）
//   &room=<名前>          … 組を分ける（タブを 4 つ開いて 2 組で試すときなど）
//   &linkDelay=<ms>      … 送るものを片道これだけ遅らせる（往復はその 2 倍）
//   &linkJitter=<ms>     … 遅れにさらに 0〜これだけの揺れを足す
//   &linkWindow=<ms>     … 相手より先に進んでよい時間（ゲーム内）を変える（既定は linkSession.ts の WINDOW_MS）
// 同じ Wi-Fi の 2 台をつなぐ画面（WebRTC と QR）は PR ③ で足す。
import { useSyncExternalStore } from "react";

import { type LinkStatus, LinkSession, type LocalGame } from "./linkSession";
import { DelayedTransport, type LinkTransport, TabTransport } from "./transport";

let session: LinkSession | null = null;
let unsubscribeSession: (() => void) | null = null;
const listeners = new Set<() => void>();
// 自分のゲームの様子。あとから始めたつながりにも伝えるために覚えておく
let localGame: LocalGame | null = null;
let localPlaying = false;

/** 自分のゲームが始まった（コアを作り直して ROM を読んだあと）・止まった（null。コアを作り直す前） */
export const setLocalGame = (info: LocalGame | null): void => {
    localGame = info;
    session?.setLocalGame(info);
};

/** 自分のゲームが動いている（一時停止していない）か */
export const setLocalPlaying = (playing: boolean): void => {
    localPlaying = playing;
    session?.setPlaying(playing);
};

const notify = (): void => listeners.forEach(listener => listener());

export const getLinkSession = (): LinkSession | null => session;

const setSession = (next: LinkSession | null): void => {
    unsubscribeSession?.();
    session = next;
    unsubscribeSession = next ? next.subscribe(notify) : null;
    notify();
};

// 開発時だけ、試験用の数を読めるようにする（link-test.html で速さを測るため）
if (import.meta.env.DEV) {
    (window as { __retroboyLink?: () => unknown }).__retroboyLink = () =>
        session && { ...session.stats(), status: session.status };
}

const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/** いまのつながりの状態。つないでいなければ null */
export const useLinkStatus = (): LinkStatus | null =>
    useSyncExternalStore(subscribe, () => session?.status ?? null);

/** 道を受け取って、新しいつながりを始める（前のつながりは切る） */
export const startLink = (
    transport: LinkTransport,
    appVersion: string,
    windowMs?: number,
): void => {
    session?.close();
    const next = new LinkSession(transport, appVersion, windowMs);
    next.setPlaying(localPlaying);
    next.setLocalGame(localGame);
    setSession(next);
};

/** 「通信を切る」。切ったあとの状態は、閉じるまで画面に残す（dismissLink で消す） */
export const closeLink = (): void => session?.close();

/** 切れたつながりの知らせを消す */
export const dismissLink = (): void => {
    if (session?.status.phase.kind === "closed") setSession(null);
};

const numberParam = (params: URLSearchParams, name: string): number => {
    const value = Number(params.get(name) ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
};

/** URL に ?link=tab があれば、タブどうしのつながりを始める（起動時に 1 回呼ぶ） */
export const startLinkFromUrl = (appVersion: string): void => {
    const params = new URLSearchParams(location.search);
    if (params.get("link") !== "tab") return;
    let transport: LinkTransport = new TabTransport(
        params.get("room") || "default",
    );
    const delay = numberParam(params, "linkDelay");
    const jitter = numberParam(params, "linkJitter");
    if (delay > 0 || jitter > 0) {
        transport = new DelayedTransport(transport, delay, jitter);
    }
    startLink(
        transport,
        appVersion,
        numberParam(params, "linkWindow") || undefined,
    );
};
