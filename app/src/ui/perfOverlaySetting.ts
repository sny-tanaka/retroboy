import { useState } from "react";

import type { RomSystem } from "../storage/romSystem";

// 速さの表示（ui/PerfOverlay.tsx）を出すか。本体ごとに覚える。GBA は iPhone で等速に動くかを見たいので、
// 初めは出しておく。Game Boy は初めは出さない
const DEFAULTS: Readonly<Record<RomSystem, boolean>> = { gb: false, gba: true };

// localStorage のキー
const storageKey = (system: RomSystem): string => `perfOverlay:${system}`;

const readStored = (system: RomSystem): boolean => {
    try {
        const value = localStorage.getItem(storageKey(system));
        return value === null ? DEFAULTS[system] : value === "1";
    } catch {
        return DEFAULTS[system];
    }
};

/** 本体ごとの「速さの表示」の出す・出さない。localStorage に覚えて、次の起動でも使う */
export const usePerfOverlaySetting = (): [
    (system: RomSystem) => boolean,
    (system: RomSystem, shown: boolean) => void,
] => {
    const [settings, setSettings] = useState<Record<RomSystem, boolean>>(
        () => ({ gb: readStored("gb"), gba: readStored("gba") }),
    );
    const set = (system: RomSystem, shown: boolean): void => {
        setSettings(current => ({ ...current, [system]: shown }));
        try {
            localStorage.setItem(storageKey(system), shown ? "1" : "0");
        } catch {
            // 覚えられなくても、この起動の間は選んだとおりに出す
        }
    };
    return [system => settings[system], set];
};
