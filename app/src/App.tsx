// 出どころ: smparsons/retroboy frontends/web/src/interface.tsx の resetGame / playGame /
//   pauseGame / resumeGame / handleRomChange / saveState / handleLoadStateChange
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: MUI の画面（StandardView / FullscreenView）とモーダル・チート・バックアップ・全画面・
//   スクリーンショットを外し、素の要素だけの最小限の UI にした（見た目は後の PR で作り直す）。
//   エラーはダイアログではなく画面内の文で出す。セーブステートの処理は emulator/saveState.ts に切り出した。
import { type ChangeEvent, useRef, useState } from "react";

import {
    EmulatorSettings,
    initializeEmulator,
    resetEmulator,
} from "./core/retroboyCore";
import GameScreen from "./emulator/GameScreen";
import {
    buildFileBufferObject,
    downloadSaveState,
    type FileBufferObject,
    loadSaveStateFile,
} from "./emulator/saveState";
import useAudioSync from "./emulator/useAudioSync";
import { useKeyListeners } from "./emulator/useKeyListeners";

type GameBoyMode = "DMG" | "CGB";

const App = () => {
    const [rom, setRom] = useState<FileBufferObject | null>(null);
    const [mode, setMode] = useState<GameBoyMode>("DMG");
    const [gameKey, setGameKey] = useState<string | null>(null);
    const [playing, setPlaying] = useState(false);
    const [paused, setPaused] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const romInputRef = useRef<HTMLInputElement>(null);
    const loadStateRef = useRef<HTMLInputElement>(null);

    useKeyListeners(playing);

    const resetGame = (): void => {
        setGameKey(null);
        setPlaying(false);
        setPaused(false);
        resetEmulator();
        setRom(null);
        if (romInputRef.current) {
            romInputRef.current.value = "";
        }
    };

    const [audioContextRef, startReset] = useAudioSync(playing, resetGame);

    const handleRomChange = async (
        event: ChangeEvent<HTMLInputElement>,
    ): Promise<void> => {
        const file = event.target.files?.[0];
        if (!file) return;
        setError(null);
        // 本家と同じく、.gbc ならカラーモードに切り替える
        if (file.name.endsWith(".gbc")) {
            setMode("CGB");
        }
        setRom(await buildFileBufferObject(file));
    };

    const playGame = (): void => {
        if (!rom) return;
        // AudioContext はユーザー操作の中で作る必要がある
        if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
        }

        const emulatorSettings = new EmulatorSettings(
            mode,
            audioContextRef.current.sampleRate,
        );
        const { error, metadata } = initializeEmulator(
            rom.data,
            emulatorSettings,
        );

        if (error) {
            setError(error);
            resetGame();
        } else if (metadata) {
            setError(null);
            setGameKey(metadata.title);
            setPlaying(true);
        }
    };

    const pauseGame = (): void => {
        setPaused(true);
        setPlaying(false);
    };

    const resumeGame = (): void => {
        setPaused(false);
        setPlaying(true);
    };

    const saveState = (): void => {
        if (gameKey && rom) {
            setError(downloadSaveState(rom.filename));
        }
    };

    const handleLoadStateChange = async (
        event: ChangeEvent<HTMLInputElement>,
    ): Promise<void> => {
        const file = event.target.files?.[0];
        if (!file) return;
        setError(await loadSaveStateFile(file));
        if (loadStateRef.current) {
            loadStateRef.current.value = "";
        }
    };

    const started = playing || paused;

    return (
        <main style={{ fontFamily: "sans-serif", padding: 16 }}>
            <h1 style={{ fontSize: 20 }}>Retro Boy Snap</h1>

            <p>
                <label>
                    ROM:{" "}
                    <input
                        ref={romInputRef}
                        type="file"
                        accept=".gb,.gbc"
                        disabled={started}
                        onChange={handleRomChange}
                    />
                </label>{" "}
                <label>
                    モード:{" "}
                    <select
                        value={mode}
                        disabled={started}
                        onChange={e => setMode(e.target.value as GameBoyMode)}
                    >
                        <option value="DMG">モノクロ (DMG)</option>
                        <option value="CGB">カラー (CGB)</option>
                    </select>
                </label>
            </p>

            <p>
                <button onClick={playGame} disabled={!rom || started}>
                    開始
                </button>{" "}
                {paused ? (
                    <button onClick={resumeGame}>再開</button>
                ) : (
                    <button onClick={pauseGame} disabled={!playing}>
                        一時停止
                    </button>
                )}{" "}
                <button onClick={startReset} disabled={!started}>
                    リセット
                </button>{" "}
                <button onClick={saveState} disabled={!started}>
                    セーブステートを保存
                </button>{" "}
                <label>
                    セーブステートを読み込む:{" "}
                    <input
                        ref={loadStateRef}
                        type="file"
                        accept=".rbs"
                        disabled={!started}
                        onChange={handleLoadStateChange}
                    />
                </label>
            </p>

            {error && <p style={{ color: "#ff6b6b" }}>{error}</p>}
            {gameKey && <p>ゲーム: {gameKey}</p>}

            <GameScreen canvasRef={canvasRef} playing={playing} paused={paused} />

            <p style={{ fontSize: 14 }}>
                操作: 十字キー = 矢印キー / A = Z / B = X / START = Enter /
                SELECT = Space
            </p>
        </main>
    );
};

export default App;
