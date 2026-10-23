// 出どころ: smparsons/retroboy frontends/web/src/hooks/useAudioSync.ts
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: window への代入に型を付けた。次の step の setTimeout を ref に持ち、一時停止とアンマウントで
//   解除するようにした（本家では一時停止してすぐ再開するとループが 2 本走り、倍速になって音も重なる）。
//
// エミュレーターの進行は音で駆動する: stepUntilNextAudioBuffer() が 1 バッファ分進めて
// window.playAudioSamples を呼び、その再生直前のタイミングで次の step を予約する。
import { type RefObject, useCallback, useEffect, useRef } from "react";

import { stepUntilNextAudioBuffer } from "../core/retroboyCore";

const GAP_BEFORE_SAMPLE_PLAY = 15;

const useAudioSync = (
    playing: boolean,
    resetGameCallback: () => void,
): [RefObject<AudioContext | null>, () => void] => {
    const audioContextRef = useRef<AudioContext | null>(null);
    const scheduledResetRef = useRef<boolean>(false);

    const nextPlayTimeRef = useRef<number>(0);
    const stepTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined,
    );

    const resetGame = (): void => {
        resetGameCallback();
        scheduledResetRef.current = false;
    };

    // 再生中はループの次の step でリセットする（step 中に resetEmulator しないため）
    const startReset = (): void => {
        if (playing) {
            scheduledResetRef.current = true;
        } else {
            resetGame();
        }
    };

    const step = useCallback(() => {
        if (scheduledResetRef.current) {
            resetGame();
        } else if (playing) {
            stepUntilNextAudioBuffer();
        }
    }, [playing]);

    useEffect(() => {
        if (playing && audioContextRef.current) {
            nextPlayTimeRef.current = audioContextRef.current.currentTime;
        }
    }, [playing]);

    useEffect(() => {
        window.playAudioSamples = (
            leftAudioSamples: Float32Array,
            rightAudioSamples: Float32Array,
        ): void => {
            const audioContext = audioContextRef.current;

            if (audioContext) {
                const bufferLength = leftAudioSamples.length;
                if (bufferLength === 0) {
                    return;
                }
                const audioBuffer = audioContext.createBuffer(
                    2,
                    bufferLength,
                    audioContext.sampleRate,
                );

                const leftChannel = audioBuffer.getChannelData(0);
                const rightChannel = audioBuffer.getChannelData(1);

                for (let i = 0; i < bufferLength; i++) {
                    leftChannel[i] = leftAudioSamples[i];
                    rightChannel[i] = rightAudioSamples[i];
                }

                const bufferSource = audioContext.createBufferSource();
                bufferSource.buffer = audioBuffer;

                const duration = bufferLength / audioContext.sampleRate;

                bufferSource.connect(audioContext.destination);

                bufferSource.start(nextPlayTimeRef.current);

                const waitTime =
                    (nextPlayTimeRef.current - audioContext.currentTime) * 1000;

                stepTimerRef.current = setTimeout(
                    step,
                    waitTime - GAP_BEFORE_SAMPLE_PLAY,
                );

                nextPlayTimeRef.current = nextPlayTimeRef.current
                    ? nextPlayTimeRef.current + duration
                    : duration;
            }
        };
    }, [playing]);

    useEffect(() => {
        if (!playing) return;
        step();
        // 一時停止・アンマウントで予約済みの step を消す。残すと再開後に古いループも走り続ける
        return () => {
            clearTimeout(stepTimerRef.current);
            stepTimerRef.current = undefined;
        };
    }, [playing]);

    return [audioContextRef, startReset];
};

export default useAudioSync;
