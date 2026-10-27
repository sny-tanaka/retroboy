// GBA の音の先読み（先に作って予約しておく音のフレームの数。gba/useGbaLoop.ts）。
// 多いほど、タイマーの遅れで音が途切れにくいが、ボタンを押してから音と絵が変わるまでが遅れる
// （1 フレーム 16.7ms）。iPhone で比べられるよう、メニューの「速さの表示」で選べるようにし、localStorage に覚える。
export const GBA_LEAD_CHOICES = [2, 3, 4, 6] as const;
export type GbaLeadFrames = (typeof GBA_LEAD_CHOICES)[number];

const DEFAULT_LEAD: GbaLeadFrames = 3;
// localStorage のキー
const STORAGE_KEY = "gbaLeadFrames";

const parse = (value: string | null): GbaLeadFrames =>
    GBA_LEAD_CHOICES.find(choice => String(choice) === value) ?? DEFAULT_LEAD;

let current: GbaLeadFrames = (() => {
    try {
        return parse(localStorage.getItem(STORAGE_KEY));
    } catch {
        return DEFAULT_LEAD;
    }
})();

export const getGbaLeadFrames = (): GbaLeadFrames => current;

export const setGbaLeadFrames = (frames: GbaLeadFrames): void => {
    current = frames;
    try {
        localStorage.setItem(STORAGE_KEY, String(frames));
    } catch {
        // 覚えられなくても、この起動の間は選んだ値で動く
    }
};
