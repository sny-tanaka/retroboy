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
 * 入る範囲で、1 ドットが実際の画面の整数個のピクセルになる一番大きい大きさ（ドットの幅がそろう）。
 * 拡大は image-rendering: pixelated なので、ぼけない。
 */
export const fitScreen = (
    availableWidth: number,
    availableHeight: number,
    devicePixelRatio: number,
    dots: ScreenSize = GB_DOTS,
): ScreenSize => {
    const scale = Math.max(
        0,
        Math.min(availableWidth / dots.width, availableHeight / dots.height),
    );
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
                ),
            );
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [reserve.width, reserve.height, dotWidth, dotHeight]);

    return size;
};
