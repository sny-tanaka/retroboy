// ゲームのボタンを押す・離す（画面のボタン・キーボードのどちらからも、ここを通す）。
// 通信ケーブルでつないでいる間はゲームが実時間よりずっと遅く進む（相手を待つ）ので、実時間で短く押したボタンが、
// ゲームの中では 1 フレームより短くなり、フレームごとにボタンを読むゲームが取りこぼす。そこで、つないでいる間は
// 離したことをコアに伝えるのを、押してからゲームの中で 1 フレーム進むまで遅らせる（link/linkSession.ts）。
// つないでいないときは、今までどおりすぐ伝える。
import { pressKey, releaseKey } from "../core/retroboyCore";
import { getLinkSession } from "../link/linkStore";

export const pressGameKey = (key: string): void => {
    getLinkSession()?.notePress(key);
    pressKey(key);
};

export const releaseGameKey = (key: string): void => {
    if (getLinkSession()?.deferRelease(key)) return;
    releaseKey(key);
};
