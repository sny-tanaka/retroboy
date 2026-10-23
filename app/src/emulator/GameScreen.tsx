// 出どころ: smparsons/retroboy frontends/web/src/components/gameScreen.tsx
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: MUI の styled を外して素の canvas にし、ref を props で受け取るようにした。
//   描画処理（window.canvasRender の登録と初期化時の黒塗り）は本家と同じ。
import { type RefObject, useEffect } from "react";

export const GAMEBOY_WIDTH = 160;
export const GAMEBOY_HEIGHT = 144;

const DEFAULT_SCALE = 2;

const renderFrame = (
    canvasContext: CanvasRenderingContext2D,
    buffer: ArrayLike<number>,
): void => {
    const data = new Uint8ClampedArray(buffer);
    const imageData = new ImageData(data, GAMEBOY_WIDTH, GAMEBOY_HEIGHT);
    canvasContext.putImageData(imageData, 0, 0);
};

const initializeCanvas = (canvasContext: CanvasRenderingContext2D): void => {
    const initialBuffer = new Uint8ClampedArray(
        GAMEBOY_WIDTH * GAMEBOY_HEIGHT * 4,
    );

    for (let i = 0; i < GAMEBOY_WIDTH * GAMEBOY_HEIGHT; i++) {
        initialBuffer[i * 4 + 3] = 0xff;
    }

    renderFrame(canvasContext, initialBuffer);
};

export const GameScreen = ({
    canvasRef,
    playing,
    paused,
    scale = DEFAULT_SCALE,
}: GameScreenProps) => {
    useEffect(() => {
        const canvasContext = canvasRef.current?.getContext("2d");
        if (canvasContext) {
            window.canvasRender = (buffer: Uint8Array): void => {
                renderFrame(canvasContext, buffer);
            };
        }

        return () => {
            window.canvasRender = () => {};
        };
    }, []);

    useEffect(() => {
        const canvasContext = canvasRef.current?.getContext("2d");
        if (canvasContext && !paused && !playing) {
            initializeCanvas(canvasContext);
        }
    }, [playing, paused]);

    return (
        <canvas
            ref={canvasRef}
            width={GAMEBOY_WIDTH}
            height={GAMEBOY_HEIGHT}
            style={{
                width: `${GAMEBOY_WIDTH * scale}px`,
                height: `${GAMEBOY_HEIGHT * scale}px`,
                border: "1px solid #888",
                imageRendering: "pixelated",
            }}
        />
    );
};

interface GameScreenProps {
    readonly canvasRef: RefObject<HTMLCanvasElement | null>;
    readonly playing: boolean;
    readonly paused: boolean;
    readonly scale?: number;
}

export default GameScreen;
