// 速さの計測（画面の隅の「59.7fps / 100%」など。ui/PerfOverlay.tsx）。
// iPhone でエミュレーターが等速で動くか・音が途切れるかを見るためのもの。GB / GBC と GBA の両方で数える:
// - フレーム: エミュレーターが進めたフレームの数（GB は画面を描いた回数、GBA は 1 フレーム進めた回数）
// - 音切れ: 次の音を予約するときに、もう前の音が鳴り終わっていた回数（その間は無音になっている）
// - 処理: エミュレーターを進めるのにかかった時間（1 フレームあたり。等速なら 16.7ms より短ければ間に合う）
import { useEffect, useState } from "react";

let frames = 0;
let underruns = 0;
let workMs = 0;

export const countFrame = (): void => {
    frames++;
};

export const countUnderrun = (): void => {
    underruns++;
};

/** エミュレーターを進めた時間（ms）。1 フレームあたりは、同じ間に数えたフレームの数で割って出す */
export const addWork = (ms: number): void => {
    workMs += ms;
};

/** ROM を始めたときに、音切れの数を 0 に戻す */
export const resetPerfStats = (): void => {
    underruns = 0;
};

export interface PerfSnapshot {
    /** 1 秒あたりのフレームの数 */
    readonly fps: number;
    /** 等速に対する割合（1 で等速） */
    readonly ratio: number;
    /** ROM を始めてからの音切れの回数 */
    readonly underruns: number;
    /** 1 フレームを進めるのにかかった時間の平均（ms）。測れなければ null */
    readonly workMsPerFrame: number | null;
}

const INTERVAL_MS = 1000;

/** enabled の間、1 秒ごとに数え直す。enabled でない間は null（また enabled になった直後の 1 秒は前の値） */
export const usePerfStats = (
    enabled: boolean,
    targetFps: number,
): PerfSnapshot | null => {
    const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
    useEffect(() => {
        if (!enabled) return;
        let since = performance.now();
        let fromFrames = frames;
        let fromWorkMs = workMs;
        const timer = setInterval(() => {
            const now = performance.now();
            const counted = frames - fromFrames;
            const fps = (counted * 1000) / (now - since);
            setSnapshot({
                fps,
                ratio: fps / targetFps,
                underruns,
                workMsPerFrame:
                    counted > 0 ? (workMs - fromWorkMs) / counted : null,
            });
            since = now;
            fromFrames = frames;
            fromWorkMs = workMs;
        }, INTERVAL_MS);
        return () => clearInterval(timer);
    }, [enabled, targetFps]);
    return enabled ? snapshot : null;
};
