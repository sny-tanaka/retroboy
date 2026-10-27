// GBA のゲームを進めるループ。Game Boy の emulator/useAudioSync.ts と同じく、音の予約の時刻で進める:
// 1 回起きるたびに、予約した音の終わりが今より LEAD 先になるまで 1 フレームずつ進め（1 フレーム = 1 つの音の
// バッファ）、最後のフレームの絵を描き、予約した音の終わりが LEAD 先になる頃にまた起きる。
// 端末が追いつかないときは、追いつける分だけ進む（遅くなる）。そのときは音が途切れるので、その回数を数える
// （emulator/perfStats.ts）。倍速は GBA では使えない。
//
// 通信ケーブルでつないでいる間は、Game Boy（emulator/useAudioSync.ts）と同じく、相手との進みを合わせながら
// 少しずつ進める（link/linkSession.ts の step。1 フレームの区切りで音を取り出す）。相手を待って止まったら
// setTimeout を予約せずに抜け、相手のメッセージが届いたら onWake で続きを走らせる。
import { type RefObject, useEffect } from "react";

import { audioOutputOf } from "../emulator/audioOutput";
import { getScreenContext } from "../emulator/GameScreen";
import { addWork, countFrame, countUnderrun } from "../emulator/perfStats";
import { getLinkSession } from "../link/linkStore";
import { getGbaCore } from "./gbaSession";
import { getGbaLeadFrames } from "./gbaLead";

// 秒。再生の始まりの前に、次の分を作り始めるまでの余裕（Game Boy と同じ）
const GAP_BEFORE_SAMPLE_PLAY = 0.015;
// 1 回起きたときに進めるフレームの上限（遅れたあとの追いつきでも、これより多くは続けない）
const MAX_FRAMES_PER_WAKE = 8;
// 秒。これ以上遅れたら、遅れた分は捨てて今に合わせ直す
const MAX_LAG = 0.1;
// 通信ケーブルでつないでいるとき、1 回起きたときに呼ぶ step の上限（1 回は 4ms ほど。Game Boy と同じ）
const MAX_LINK_STEPS_PER_WAKE = 32;

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
        // 通信ケーブルで相手を待って止まっている（onWake で続きを走らせる）
        let waitingForPeer = false;

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

        const leadReached = (): boolean =>
            nextPlayTime - audioContext.currentTime >= lead;
        const draw = (): void => {
            const context = getScreenContext();
            if (context) core.draw(context);
        };
        // 相手のメッセージが届いた・つながりが切れた。止まっていたときだけ続きを走らせる（ループを 2 本にしない）
        const wake = (): void => {
            if (!waitingForPeer) return;
            waitingForPeer = false;
            step();
        };

        const step = (): void => {
            // 止めた・ほかの ROM にした
            if (getGbaCore() !== core) return;
            const workStart = performance.now();
            const link = getLinkSession();
            if (link?.stepping) {
                link.onWake = wake;
                let frames = 0;
                for (let i = 0; i < MAX_LINK_STEPS_PER_WAKE; i++) {
                    const outcome = link.step();
                    if (outcome === "stalled") {
                        // 相手を待つ。音はその分だけ途切れる
                        waitingForPeer = true;
                        if (frames > 0) draw();
                        addWork(performance.now() - workStart);
                        return;
                    }
                    if (outcome === "audio") {
                        const [left, right] = core.takeFrameAudio();
                        countFrame();
                        play(left, right);
                        frames += 1;
                        if (leadReached() || frames >= MAX_FRAMES_PER_WAKE) {
                            break;
                        }
                    }
                }
            } else {
                for (let i = 0; i < MAX_FRAMES_PER_WAKE; i++) {
                    const [left, right] = core.runFrame();
                    countFrame();
                    play(left, right);
                    if (leadReached()) break;
                }
            }
            draw();
            addWork(performance.now() - workStart);
            const waitTime =
                (nextPlayTime - audioContext.currentTime - lead) * 1000;
            timer = setTimeout(step, Math.max(0, waitTime));
        };
        step();
        // 一時停止・アンマウントで予約済みの step を消す
        return () => {
            clearTimeout(timer);
            waitingForPeer = false;
            const link = getLinkSession();
            if (link?.onWake === wake) link.onWake = null;
        };
    }, [playing, audioContextRef]);
};

export default useGbaLoop;
