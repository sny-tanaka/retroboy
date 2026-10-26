// 音の出口。開発サーバー（vite）では既定で無音にし、URL に ?sound=1 を付けたときだけ鳴らす。
// 本番ビルドでも ?mute=1 があれば無音（vite preview や Playwright で本番ビルドを確かめるとき用）。
//
// 無音でも AudioContext は止めない（エミュレーターは音の予約の時刻で進むので、止めるとゲームも止まる）。
// 音の予約はいつもどおり行い、出口の手前に音量 0 の GainNode を挟んで、スピーカーに届く音だけを消す。

const isMuted = (): boolean => {
    const params = new URLSearchParams(location.search);
    if (params.get("mute") === "1") return true;
    return import.meta.env.DEV && params.get("sound") !== "1";
};

const muted = isMuted();
const muteNodes = new WeakMap<AudioContext, GainNode>();

/** 鳴らす音をつなぐ先。鳴らすときは destination そのもの、無音のときは destination の手前の音量 0 の GainNode */
export const audioOutputOf = (audioContext: AudioContext): AudioNode => {
    if (!muted) return audioContext.destination;
    let node = muteNodes.get(audioContext);
    if (!node) {
        node = audioContext.createGain();
        node.gain.value = 0;
        node.connect(audioContext.destination);
        muteNodes.set(audioContext, node);
    }
    return node;
};
