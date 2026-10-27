// 出どころ: smparsons/retroboy frontends/web/src/components/gameScreen.tsx
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: MUI の styled を外して素の canvas にし、ref を props で受け取るようにした。
//   表示の大きさは親（ui/GbcBody の画面枠）に合わせるので、倍率（scale）と枠線は持たない。
//   描画処理（window.canvasRender の登録と初期化時の黒塗り）は本家と同じ。
//   GBA（240x160）でも使えるよう、大きさを props で受け取るようにした。GBA の描画（gba/useGbaLoop.ts）が使う
//   2D の context を screenContext で渡す。速さの計測（perfStats.ts）のため、描いた回数を数える。
import { type RefObject, useEffect } from "react";

import { countFrame } from "./perfStats";

export const GAMEBOY_WIDTH = 160;
export const GAMEBOY_HEIGHT = 144;

const renderFrame = (
    canvasContext: CanvasRenderingContext2D,
    buffer: ArrayLike<number>,
    width: number,
    height: number,
): void => {
    const data = new Uint8ClampedArray(buffer);
    const imageData = new ImageData(data, width, height);
    canvasContext.putImageData(imageData, 0, 0);
};

const initializeCanvas = (
    canvasContext: CanvasRenderingContext2D,
    width: number,
    height: number,
): void => {
    const initialBuffer = new Uint8ClampedArray(width * height * 4);

    for (let i = 0; i < width * height; i++) {
        initialBuffer[i * 4 + 3] = 0xff;
    }

    renderFrame(canvasContext, initialBuffer, width, height);
};

// ゲーム画面の 2D の context（GBA の描画が使う）
let screenContext: CanvasRenderingContext2D | null = null;
export const getScreenContext = (): CanvasRenderingContext2D | null =>
    screenContext;

export const GameScreen = ({
    canvasRef,
    playing,
    paused,
    width = GAMEBOY_WIDTH,
    height = GAMEBOY_HEIGHT,
}: GameScreenProps) => {
    useEffect(() => {
        const canvasContext = canvasRef.current?.getContext("2d");
        if (canvasContext) {
            screenContext = canvasContext;
            window.canvasRender = (buffer: Uint8Array): void => {
                countFrame();
                renderFrame(
                    canvasContext,
                    buffer,
                    GAMEBOY_WIDTH,
                    GAMEBOY_HEIGHT,
                );
            };
        }

        return () => {
            screenContext = null;
            window.canvasRender = () => {};
        };
    }, []);

    useEffect(() => {
        const canvasContext = canvasRef.current?.getContext("2d");
        if (canvasContext && !paused && !playing) {
            initializeCanvas(canvasContext, width, height);
        }
    }, [playing, paused, width, height]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            style={{
                display: "block",
                width: "100%",
                height: "100%",
                imageRendering: "pixelated",
            }}
        />
    );
};

interface GameScreenProps {
    readonly canvasRef: RefObject<HTMLCanvasElement | null>;
    readonly playing: boolean;
    readonly paused: boolean;
    /** canvas の大きさ（ドット）。既定は Game Boy の 160x144。GBA は 240x160 */
    readonly width?: number;
    readonly height?: number;
}

export default GameScreen;
