import { type RefObject, useEffect, useState } from "react";

export const GB_WIDTH = 160;
export const GB_HEIGHT = 144;

export interface ScreenSize {
    readonly width: number;
    readonly height: number;
}

/**
 * 入る範囲で、1 ドットが実際の画面の整数個のピクセルになる一番大きい大きさ（ドットの幅がそろう）。
 * 拡大は image-rendering: pixelated なので、ぼけない。
 */
export const fitScreen = (
    availableWidth: number,
    availableHeight: number,
    devicePixelRatio: number,
): ScreenSize => {
    const scale = Math.max(
        0,
        Math.min(availableWidth / GB_WIDTH, availableHeight / GB_HEIGHT),
    );
    if (scale * devicePixelRatio < 1) {
        return { width: GB_WIDTH * scale, height: GB_HEIGHT * scale };
    }
    const devicePixels = Math.floor(scale * devicePixelRatio);
    return {
        width: (GB_WIDTH * devicePixels) / devicePixelRatio,
        height: (GB_HEIGHT * devicePixels) / devicePixelRatio,
    };
};

/**
 * ref の要素の中身の大きさから、reserve（縦・横に取っておく分）を引いた場所に入るゲーム画面の大きさ。
 * 要素の大きさが変わる（回転・ホームバーの出入りなど）たびに計算し直す。
 */
export const useScreenSize = (
    ref: RefObject<HTMLElement | null>,
    reserve: { readonly width: number; readonly height: number },
): ScreenSize => {
    const [size, setSize] = useState<ScreenSize>({
        width: GB_WIDTH,
        height: GB_HEIGHT,
    });

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
                ),
            );
        };

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [reserve.width, reserve.height]);

    return size;
};
