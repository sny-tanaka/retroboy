import { type RefObject, useEffect, useState } from "react";

export const GB_WIDTH = 160;
export const GB_HEIGHT = 144;

export interface ScreenSize {
    readonly width: number;
    readonly height: number;
}

/** ゲーム画面のドットの数。既定は Game Boy（160x144）。GBA は 240x160 */
const GB_DOTS: ScreenSize = { width: GB_WIDTH, height: GB_HEIGHT };

/**
 * 画面の拡大のしかた。
 * - integer: 入る範囲で、1 ドットが実際の画面の整数個のピクセルになる一番大きい大きさ（ドットの幅がそろう。GB / GBC）
 * - fill: 縦横の比を保って、入る範囲いっぱい（GBA。整数倍でないので、ドットの幅が 1 ピクセルずつ不ぞろいになる）。
 *   大きさは実際の画面のピクセルの境目にそろえる（縁がにじまないように）
 * どちらも拡大は image-rendering: pixelated なので、ぼけない。
 */
export type ScreenScaling = "integer" | "fill";

export const fitScreen = (
    availableWidth: number,
    availableHeight: number,
    devicePixelRatio: number,
    dots: ScreenSize = GB_DOTS,
    scaling: ScreenScaling = "integer",
): ScreenSize => {
    const scale = Math.max(
        0,
        Math.min(availableWidth / dots.width, availableHeight / dots.height),
    );
    if (scaling === "fill") {
        const height = Math.floor(dots.height * scale * devicePixelRatio);
        // 縦をピクセルの境目にそろえ、横は縦から比で決めて切り捨てる（入る範囲を超えない。比のずれは 1 ピクセル未満）
        const width = Math.floor((height * dots.width) / dots.height);
        return {
            width: width / devicePixelRatio,
            height: height / devicePixelRatio,
        };
    }
    if (scale * devicePixelRatio < 1) {
        return { width: dots.width * scale, height: dots.height * scale };
    }
    const devicePixels = Math.floor(scale * devicePixelRatio);
    return {
        width: (dots.width * devicePixels) / devicePixelRatio,
        height: (dots.height * devicePixels) / devicePixelRatio,
    };
};

/**
 * ref の要素の中身の大きさから、reserve（縦・横に取っておく分）を引いた場所に入るゲーム画面の大きさ。
 * 要素の大きさが変わる（回転・ホームバーの出入りなど）たびに計算し直す。
 */
export const useScreenSize = (
    ref: RefObject<HTMLElement | null>,
    reserve: { readonly width: number; readonly height: number },
    dots: ScreenSize = GB_DOTS,
    scaling: ScreenScaling = "integer",
): ScreenSize => {
    const [size, setSize] = useState<ScreenSize>(dots);
    const { width: dotWidth, height: dotHeight } = dots;

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const measure = () => {
            const style = getComputedStyle(element);
            const innerWidth =
                element.clientWidth -
                parseFloat(style.paddingLeft) -
                parseFloat(style.paddingRight);
            const innerHeight =
                element.clientHeight -
                parseFloat(style.paddingTop) -
                parseFloat(style.paddingBottom);
            setSize(
                fitScreen(
                    innerWidth - reserve.width,
                    innerHeight - reserve.height,
                    window.devicePixelRatio || 1,
                    { width: dotWidth, height: dotHeight },
                    scaling,
                ),
            );
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [reserve.width, reserve.height, dotWidth, dotHeight, scaling]);

    return size;
};
