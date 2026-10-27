// GBA のゲームを進めるループ。Game Boy の emulator/useAudioSync.ts と同じく、音の予約の時刻で進める:
// 1 回起きるたびに、予約した音の終わりが今より LEAD 先になるまで 1 フレームずつ進め（1 フレーム = 1 つの音の
// バッファ）、最後のフレームの絵を描き、予約した音の終わりが LEAD 先になる頃にまた起きる。
// 端末が追いつかないときは、追いつける分だけ進む（遅くなる）。そのときは音が途切れるので、その回数を数える
// （emulator/perfStats.ts）。倍速・通信ケーブルは GBA では使えない。
import { type RefObject, useEffect } from "react";

import { audioOutputOf } from "../emulator/audioOutput";
import { getScreenContext } from "../emulator/GameScreen";
import { addWork, countFrame, countUnderrun } from "../emulator/perfStats";
import { getGbaCore } from "./gbaSession";
import { getGbaLeadFrames } from "./gbaLead";

// 秒。再生の始まりの前に、次の分を作り始めるまでの余裕（Game Boy と同じ）
const GAP_BEFORE_SAMPLE_PLAY = 0.015;
// 1 回起きたときに進めるフレームの上限（遅れたあとの追いつきでも、これより多くは続けない）
const MAX_FRAMES_PER_WAKE = 8;
// 秒。これ以上遅れたら、遅れた分は捨てて今に合わせ直す
const MAX_LAG = 0.1;

const useGbaLoop = (
    playing: boolean,
    audioContextRef: RefObject<AudioContext | null>,
): void => {
    useEffect(() => {
        if (!playing) return;
        const audioContext = audioContextRef.current;
        const core = getGbaCore();
        if (!audioContext || !core) return;
        // 先読みの長さ（メニューで選ぶ）。メニューを開くと止まり、閉じると始め直すので、そこで新しい値になる
        const lead =
            GAP_BEFORE_SAMPLE_PLAY + getGbaLeadFrames() / core.frameRate;
        let nextPlayTime = audioContext.currentTime;
        // 1 つめの音は今より少し前になるので、音切れに数えない
        let primed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const play = (left: Float32Array, right: Float32Array): void => {
            if (left.length === 0) return;
            const now = audioContext.currentTime;
            if (nextPlayTime < now) {
                if (primed) countUnderrun();
                // 少しの遅れは続けて鳴らして追いつく。大きく遅れたら今に合わせ直す
                if (nextPlayTime < now - MAX_LAG) nextPlayTime = now;
            }
            primed = true;
            const buffer = audioContext.createBuffer(
                2,
                left.length,
                audioContext.sampleRate,
            );
            buffer.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
            buffer.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
            const source = audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(audioOutputOf(audioContext));
            source.start(nextPlayTime);
            nextPlayTime += buffer.duration;
        };

        const step = (): void => {
            // 止めた・ほかの ROM にした
            if (getGbaCore() !== core) return;
            const workStart = performance.now();
            for (let i = 0; i < MAX_FRAMES_PER_WAKE; i++) {
                const [left, right] = core.runFrame();
                countFrame();
                play(left, right);
                if (nextPlayTime - audioContext.currentTime >= lead) break;
            }
            const context = getScreenContext();
            if (context) core.draw(context);
            addWork(performance.now() - workStart);
            const waitTime =
                (nextPlayTime - audioContext.currentTime - lead) * 1000;
            timer = setTimeout(step, Math.max(0, waitTime));
        };
        step();
        return () => clearTimeout(timer);
    }, [playing, audioContextRef]);
};

export default useGbaLoop;
