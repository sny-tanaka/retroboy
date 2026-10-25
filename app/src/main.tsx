import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import init from "./core/retroboyCore";
import registerCartridgeEffects, {
    setWasmMemory,
} from "./emulator/cartridgeEffects";
import { startLinkFromUrl } from "./link/linkStore";
import registerServiceWorker, {
    APP_VERSION,
} from "./pwa/registerServiceWorker";

registerCartridgeEffects();
registerServiceWorker();

const root = createRoot(document.getElementById("root") as HTMLElement);

// 本家の WasmLoader と同じく、WASM の初期化が終わってから画面を出す
root.render(<p>読み込み中…</p>);
init().then(
    wasm => {
        setWasmMemory(wasm.memory);
        // 試験用の ?link=tab（同じブラウザのタブどうしの通信ケーブル）
        startLinkFromUrl(APP_VERSION);
        root.render(
            <StrictMode>
                <App />
            </StrictMode>,
        );
    },
    (err: unknown) => {
        console.error("WASM の読み込みに失敗しました:", err);
        root.render(<p>エミュレーターの読み込みに失敗しました。</p>);
    },
);
