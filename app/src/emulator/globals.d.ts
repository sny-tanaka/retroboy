// WASM コア（vendor/retroboy/src/wasm/api.rs の extern "C" ブロック）が呼び出す window 上の関数。
// 本家 frontends/web では (window as any) で代入していたものに型を付けたもの。
import type { WasmRTCState } from "../core/retroboyCore";

declare global {
    interface Window {
        canvasRender: (frameBuffer: Uint8Array) => void;
        playAudioSamples: (
            leftSamples: Float32Array,
            rightSamples: Float32Array,
        ) => void;
        currentTimeMillis: () => number;
        loadRTCState: (key: string) => WasmRTCState | null;
        saveRTCState: (key: string, value: WasmRTCState) => void;
        loadRam: (key: string) => Uint8Array | null;
        saveRam: (key: string, value: Uint8Array) => void;
    }
}
