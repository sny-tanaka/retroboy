// 出どころ: smparsons/retroboy frontends/web/src/hooks/useKeyListeners.ts と
//   frontends/web/src/modals/controlsModal.tsx の initialKeyMap
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: キー設定の保存（useSettingsStore）とモーダル中の無効化を外し、既定のキー割り当てに固定した。
//   一時停止・リセット・アンマウントのときに全ボタンを離すようにした（keyup がコアに届かず押しっぱなしになるため）。
//   GBA の L・R（A・S のキー）を足した（Game Boy のコアには送らない。emulator/gameKeys.ts）。
import { useEffect } from "react";

import {
    pressGameKey,
    releaseAllGameKeys,
    releaseGameKey,
} from "./gameKeys";

// KeyboardEvent.code（本家と同じく、無ければ KeyboardEvent.key）→ コアの pressKey/releaseKey に渡すボタン名
export const keyMap: Record<string, string> = {
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Enter: "Start",
    Space: "Select",
    KeyX: "B",
    KeyZ: "A",
    KeyA: "L",
    KeyS: "R",
};

const toControl = (event: KeyboardEvent): string | undefined =>
    keyMap[event.code] || keyMap[event.key];

export const releaseAllKeys = (): void => {
    releaseAllGameKeys(Object.values(keyMap));
};

export const useKeyListeners = (playing: boolean): void => {
    useEffect(() => {
        if (!playing) return;

        const handleKeyDown = (event: KeyboardEvent): void => {
            const control = toControl(event);
            if (control) {
                event.preventDefault();
                pressGameKey(control);
            }
        };

        const handleKeyUp = (event: KeyboardEvent): void => {
            const control = toControl(event);
            if (control) {
                event.preventDefault();
                releaseGameKey(control);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            // 止めている間の keyup はコアに届かないので、ここで全部離した状態にする
            releaseAllKeys();
        };
    }, [playing]);
};
