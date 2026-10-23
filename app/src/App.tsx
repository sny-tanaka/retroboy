// 出どころ: smparsons/retroboy frontends/web/src/interface.tsx の resetGame / playGame /
//   pauseGame / resumeGame / handleRomChange / saveState / handleLoadStateChange
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: MUI の画面（StandardView / FullscreenView）とモーダル・チート・バックアップ・全画面・
//   スクリーンショットを外し、素の要素だけの最小限の UI にした（見た目は後の PR で作り直す）。
//   エラーはダイアログではなく画面内の文で出す。セーブステートの処理は emulator/saveState.ts に、
//   状態とロジック（ROM の保存・自動読み込み・起動）は session/useRomSession.ts に切り出した。
//   モードの選択は外し、ROM ヘッダの CGB フラグか拡張子 .gbc で決めるようにした。
import { type ChangeEvent, useRef } from "react";

import GameScreen from "./emulator/GameScreen";
import useRomSession, { type SessionStatus } from "./session/useRomSession";
import type { StorageStatus } from "./storage/storageStatus";

const errorColor = "#ff6b6b";

const StatusMessage = ({
    status,
    onStart,
}: {
    status: SessionStatus;
    onStart: () => void;
}) => {
    switch (status.kind) {
        case "booting":
            return <p>保存した ROM を確認中…</p>;
        case "noRom":
            return <p>ROM を追加するか、一覧から選んでください。</p>;
        case "loading":
            return <p>{status.message}</p>;
        case "ready":
            return (
                <p>
                    <button onClick={onStart} style={{ fontSize: 18 }}>
                        タップして開始
                    </button>{" "}
                    {status.rom.name}
                </p>
            );
        case "running":
            return (
                <p>
                    ゲーム: {status.title}（{status.rom.name}）
                </p>
            );
        case "error":
            return (
                <div role="alert">
                    <p style={{ color: errorColor }}>{status.message}</p>
                    <p>
                        <button onClick={status.retry}>再試行</button>{" "}
                        または下の一覧から ROM を選び直してください。
                    </p>
                </div>
            );
    }
};

const formatStorage = ({ persisted, usageMB, quotaMB }: StorageStatus): string =>
    [
        `永続化: ${persisted === null ? "未対応" : persisted ? "許可" : "未許可"}`,
        `使用量: ${usageMB ?? "?"} MB / ${quotaMB ?? "?"} MB`,
    ].join("　");

const App = () => {
    const session = useRomSession();
    const { status, playing, paused, roms } = session;
    const running = status.kind === "running";
    const busy = status.kind === "booting" || status.kind === "loading";
    const currentRomId =
        status.kind === "ready" || status.kind === "running"
            ? status.rom.id
            : null;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const romInputRef = useRef<HTMLInputElement>(null);
    const loadStateRef = useRef<HTMLInputElement>(null);

    const openRomPicker = (): void => {
        session.unlockAudio();
        romInputRef.current?.click();
    };

    const handleRomChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void session.addRomFile(file);
    };

    const handleLoadStateChange = (event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void session.loadState(file);
    };

    return (
        <main style={{ fontFamily: "sans-serif", padding: 16 }}>
            <h1 style={{ fontSize: 20 }}>Retro Boy Snap</h1>

            <StatusMessage status={status} onStart={session.startReadyRom} />

            {session.notice && (
                <p role="alert" style={{ color: errorColor }}>
                    {session.notice}{" "}
                    <button onClick={session.dismissNotice}>閉じる</button>
                </p>
            )}

            <GameScreen canvasRef={canvasRef} playing={playing} paused={paused} />

            <p>
                {paused ? (
                    <button onClick={session.resume}>再開</button>
                ) : (
                    <button onClick={session.pause} disabled={!playing}>
                        一時停止
                    </button>
                )}{" "}
                <button onClick={session.stop} disabled={!running}>
                    止める
                </button>{" "}
                <button onClick={session.saveState} disabled={!running}>
                    セーブステートを保存
                </button>{" "}
                <button
                    onClick={() => loadStateRef.current?.click()}
                    disabled={!running}
                >
                    セーブステートを読み込む
                </button>
                {/* accept は付けない（iOS は .rbs を知らず、ファイルを選べなくなることがある） */}
                <input
                    ref={loadStateRef}
                    type="file"
                    hidden
                    onChange={handleLoadStateChange}
                />
            </p>

            <section>
                <h2 style={{ fontSize: 16 }}>保存した ROM</h2>
                {roms.length === 0 ? (
                    <p>まだありません。</p>
                ) : (
                    <ul>
                        {roms.map(rom => (
                            <li key={rom.id}>
                                <button
                                    onClick={() => session.selectRom(rom.id)}
                                    disabled={running || busy}
                                >
                                    {rom.id === currentRomId ? "▶ " : ""}
                                    {rom.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <p>
                    <button onClick={openRomPicker} disabled={running || busy}>
                        ROM を追加
                    </button>
                    {/* accept は付けない（iOS は .gb / .gbc を知らず、ファイルを選べなくなることがある） */}
                    <input
                        ref={romInputRef}
                        type="file"
                        hidden
                        onChange={handleRomChange}
                    />
                </p>
                {running && (
                    <p style={{ fontSize: 14 }}>
                        ROM を替えるときは「止める」を押してください。
                    </p>
                )}
            </section>

            <p style={{ fontSize: 14 }}>
                操作: 十字キー = 矢印キー / A = Z / B = X / START = Enter /
                SELECT = Space
            </p>

            {session.storageStatus && (
                <p style={{ fontSize: 12, color: "#9e9e9e" }}>
                    {formatStorage(session.storageStatus)}
                </p>
            )}
        </main>
    );
};

export default App;
