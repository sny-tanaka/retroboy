// 出どころ: smparsons/retroboy frontends/web/src/hooks/useAudioSync.ts
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: window への代入に型を付けた。次の step の setTimeout を ref に持ち、一時停止とアンマウントで
//   解除するようにした（本家では一時停止してすぐ再開するとループが 2 本走り、倍速になって音も重なる）。
//   再生の予定が今より MAX_LAG 以上遅れたら、追いつかずに今に合わせ直すようにした（本家ではメインスレッドが
//   止まったあと、遅れを取り戻すまで step が待ちなしで続き、倍速になる）。
//   倍速（speed）を足した。倍速のときは 1 バッファを timeStretch.ts で高さを変えずに 1/speed の長さに
//   縮めて等速で鳴らし、次の再生の予定をその長さだけ進める（×1 では素通し）。遅れの合わせ直しは実時間で
//   見るので、追いつかなければ速さが落ちるだけ。
//
// エミュレーターの進行は音で駆動する: stepUntilNextAudioBuffer() が 1 バッファ分進めて
// window.playAudioSamples を呼び、その再生直前のタイミングで次の step を予約する。
import { type RefObject, useCallback, useEffect, useRef } from "react";

import { stepUntilNextAudioBuffer } from "../core/retroboyCore";
import { TimeStretcher } from "./timeStretch";

const GAP_BEFORE_SAMPLE_PLAY = 15;
// 秒。これ以上遅れたら、遅れた分の音とゲームの進みは捨てる。少しの遅れは、音が途切れないよう追いつく
const MAX_LAG = 0.1;

const useAudioSync = (
    playing: boolean,
    resetGameCallback: () => void,
    // 速さ（1 で等速）。変えると次に鳴らすバッファから効く
    speed: number,
): [RefObject<AudioContext | null>, () => void] => {
    const audioContextRef = useRef<AudioContext | null>(null);
    const speedRef = useRef(speed);
    useEffect(() => {
        speedRef.current = speed;
    }, [speed]);
    const scheduledResetRef = useRef<boolean>(false);
    // 倍速の音を縮める。区間の長さがサンプルレートで決まるので、AudioContext のサンプルレートで作る
    const stretcherRef = useRef<TimeStretcher | null>(null);

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
                if (leftAudioSamples.length === 0) {
                    return;
                }
                if (
                    stretcherRef.current?.sampleRate !== audioContext.sampleRate
                ) {
                    stretcherRef.current = new TimeStretcher(
                        audioContext.sampleRate,
                    );
                }
                // 倍速では高さを変えずに 1/speed の長さに縮める。×1 では受け取ったものがそのまま返る
                const [left, right] = stretcherRef.current.process(
                    leftAudioSamples,
                    rightAudioSamples,
                    speedRef.current,
                );
                const bufferLength = left.length;
                const duration = bufferLength / audioContext.sampleRate;

                if (
                    nextPlayTimeRef.current <
                    audioContext.currentTime - MAX_LAG
                ) {
                    nextPlayTimeRef.current = audioContext.currentTime;
                }

                // 倍速に切り替えた直後は、縮めた音がまだできていないことがある。鳴らさずに次の step へ進む
                if (bufferLength > 0) {
                    const audioBuffer = audioContext.createBuffer(
                        2,
                        bufferLength,
                        audioContext.sampleRate,
                    );

                    const leftChannel = audioBuffer.getChannelData(0);
                    const rightChannel = audioBuffer.getChannelData(1);

                    for (let i = 0; i < bufferLength; i++) {
                        leftChannel[i] = left[i];
                        rightChannel[i] = right[i];
                    }

                    const bufferSource = audioContext.createBufferSource();
                    bufferSource.buffer = audioBuffer;
                    bufferSource.connect(audioContext.destination);
                    bufferSource.start(nextPlayTimeRef.current);
                }

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
