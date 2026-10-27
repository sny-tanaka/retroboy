// ゲームのボタンを押す・離す（画面のボタン・キーボードのどちらからも、ここを通す）。
// 通信ケーブルでつないでいる間はゲームが実時間よりずっと遅く進む（相手を待つ）ので、実時間で短く押したボタンが、
// ゲームの中では 1 フレームより短くなり、フレームごとにボタンを読むゲームが取りこぼす。そこで、つないでいる間は
// 離したことをコアに伝えるのを、押してからゲームの中で 1 フレーム進むまで遅らせる（link/linkSession.ts）。
// つないでいないときは、今までどおりすぐ伝える。
// GBA のゲームが動いている間は、mGBA（gba/gbaSession.ts）に伝える（通信ケーブルの遅らせも同じ）。L・R は GBA
// だけのボタンで、Game Boy のコアには送らない。
import { pressKey, releaseKey } from "../core/retroboyCore";
import {
    getGbaCore,
    pressGbaKey,
    releaseAllGbaKeys,
    releaseGbaKey,
} from "../gba/gbaSession";
import { getLinkSession } from "../link/linkStore";

const GBA_ONLY = new Set(["L", "R"]);

export const pressGameKey = (key: string): void => {
    if (getGbaCore()) {
        getLinkSession()?.notePress(key);
        pressGbaKey(key);
        return;
    }
    if (GBA_ONLY.has(key)) return;
    getLinkSession()?.notePress(key);
    pressKey(key);
};

export const releaseGameKey = (key: string): void => {
    if (getGbaCore()) {
        if (getLinkSession()?.deferRelease(key)) return;
        releaseGbaKey(key);
        return;
    }
    if (GBA_ONLY.has(key)) return;
    if (getLinkSession()?.deferRelease(key)) return;
    releaseKey(key);
};

/** すぐ離す（通信ケーブルの遅らせをしない。操作の配置を切り替えたときなど） */
export const releaseGameKeyNow = (key: string): void => {
    if (getGbaCore()) {
        releaseGbaKey(key);
        return;
    }
    if (GBA_ONLY.has(key)) return;
    releaseKey(key);
};

/** 全部離す（一時停止・止めたとき） */
export const releaseAllGameKeys = (keys: Iterable<string>): void => {
    releaseAllGbaKeys();
    for (const key of keys) {
        if (!GBA_ONLY.has(key)) releaseKey(key);
    }
};
