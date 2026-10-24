// 出どころ: smparsons/retroboy frontends/web/src/interface.tsx の resetGame / playGame /
//   pauseGame / resumeGame / handleRomChange / saveState / handleLoadStateChange
//   (commit edf90d9fb192372a657a18d44f5c9841805fa554)
// Copyright smparsons. Licensed under the Apache License, Version 2.0.
// 変更点: MUI の画面（StandardView / FullscreenView）とモーダル・チート・バックアップ・全画面・
//   スクリーンショットを外し、ゲームボーイカラー風の本体（ui/GbcBody）にした。
//   開始・読み込み中・エラーはダイアログではなくゲーム画面の中に出す。セーブステートの処理は
//   emulator/saveState.ts に、状態とロジック（ROM の保存・自動読み込み・起動）は session/useRomSession.ts に切り出した。
//   モードの選択は外し、ROM ヘッダの CGB フラグか拡張子 .gbc で決めるようにした。
import {
    type RefObject,
    useEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from "react";

import { pressKey, releaseKey } from "./core/retroboyCore";
import { flushPendingSaves } from "./emulator/cartridgeEffects";
import GameScreen from "./emulator/GameScreen";
import {
    APP_VERSION,
    isUpdateReady,
    onUpdateReady,
} from "./pwa/registerServiceWorker";
import useRomSession, { type SessionStatus } from "./session/useRomSession";
import type { GbButton } from "./ui/buttons";
import { LoadStateConfirm } from "./ui/ConfirmDialog";
import { type ControlLayout, useControlLayout } from "./ui/controlLayout";
import { GbcBody } from "./ui/GbcBody";
import { MenuSheet } from "./ui/MenuSheet";
import { RomMenu } from "./ui/RomMenu";

// ゲーム画面の中に出す案内（開始・読み込み中・エラー・ROM 未登録）。遊んでいる間は出さない
const ScreenMessage = ({
    status,
    onStart,
    onAddRom,
    onOpenMenu,
}: {
    status: SessionStatus;
    onStart: () => void;
    onAddRom: () => void;
    onOpenMenu: () => void;
}) => {
    switch (status.kind) {
        case "booting":
            return <p className="gbc-overlay-text">読み込み中…</p>;
        case "loading":
            return <p className="gbc-overlay-text">{status.message}</p>;
        case "noRom":
            return (
                <div className="gbc-overlay-panel">
                    <p className="gbc-overlay-text">ROM が登録されていません</p>
                    <button
                        type="button"
                        className="gbc-overlay-button"
                        onClick={onAddRom}
                    >
                        ROM を追加
                    </button>
                </div>
            );
        case "ready":
            return (
                <button
                    type="button"
                    className="gbc-overlay-start"
                    onClick={onStart}
                >
                    <span className="gbc-overlay-start-label">
                        ▶ タップして開始
                    </span>
                    <span className="gbc-overlay-sub">{status.rom.name}</span>
                </button>
            );
        case "error":
            return (
                <div className="gbc-overlay-panel" role="alert">
                    <p className="gbc-overlay-text gbc-overlay-error">
                        {status.message}
                    </p>
                    <div className="gbc-overlay-actions">
                        <button
                            type="button"
                            className="gbc-overlay-button"
                            onClick={status.retry}
                        >
                            再試行
                        </button>
                        <button
                            type="button"
                            className="gbc-overlay-button gbc-overlay-secondary"
                            onClick={onOpenMenu}
                        >
                            ROM を選び直す
                        </button>
                    </div>
                </div>
            );
        case "running":
            return null;
    }
};

// 一時停止の理由になる、開いているもの
type Overlay = "menu" | "confirm" | "romPicker" | "statePicker";
type FilePicker = "romPicker" | "statePicker";

// ファイル選択から戻ってきたあと、選んだファイルの change を待つ時間
const PICKER_SETTLE_MS = 600;

/**
 * ファイル選択を閉じたら onClose を呼ぶ。選んだときは change（呼ぶ側）、やめたときは cancel で分かる。
 * cancel が届かない環境（iOS 16.4 未満・ホーム画面のアプリなど）のために、画面に戻ってきたとき
 * （visibilitychange で visible・window の focus）にも、少し待ってから呼ぶ（change を先に受けるため）。
 * onClose は何度呼ばれてもよい作りにすること。
 */
const useFilePickerClose = (
    inputRef: RefObject<HTMLInputElement | null>,
    onClose: () => void,
): void => {
    const latest = useRef(onClose);
    useEffect(() => {
        latest.current = onClose;
    });
    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        const timers = new Set<ReturnType<typeof setTimeout>>();
        const handleCancel = () => latest.current();
        const handleBack = () => {
            if (document.visibilityState !== "visible") return;
            const timer = setTimeout(() => {
                timers.delete(timer);
                latest.current();
            }, PICKER_SETTLE_MS);
            timers.add(timer);
        };
        input.addEventListener("cancel", handleCancel);
        window.addEventListener("focus", handleBack);
        document.addEventListener("visibilitychange", handleBack);
        return () => {
            input.removeEventListener("cancel", handleCancel);
            window.removeEventListener("focus", handleBack);
            document.removeEventListener("visibilitychange", handleBack);
            timers.forEach(clearTimeout);
        };
    }, []);
};

// 新しい版に切り替える。待っているゲーム内セーブを先に書き出してから読み込み直す
const reloadToUpdate = (): void => {
    flushPendingSaves();
    location.reload();
};

const App = () => {
    const session = useRomSession();
    // 新しい版の Service Worker が入った。勝手には読み込み直さず、知らせて押してもらう
    const updateReady = useSyncExternalStore(onUpdateReady, isUpdateReady);
    const [updateDismissed, setUpdateDismissed] = useState(false);
    const showUpdateNotice = updateReady && !updateDismissed;
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
    const [menuOpen, setMenuOpen] = useState(false);
    // 開いているロードの確認。"slot" は画面の「ロード」（端末内のセーブ）、"file" はメニューの「ファイルから読み込む」
    const [confirmingLoad, setConfirmingLoad] = useState<
        "slot" | "file" | null
    >(null);

    // メニュー・確認・ファイル選択を開いている間は一時停止し、全部閉じたら元の状態に戻す。
    // 数ではなく名前で持つので、同じものを二重に閉じても数がずれない。
    // ファイル選択の閉じた知らせが来ないまま残っても、ほかのものを開けば一時停止はする
    const openRef = useRef(new Set<Overlay>());
    const resumeAfterRef = useRef(false);
    const hold = (overlay: Overlay): void => {
        openRef.current.add(overlay);
        if (playing) {
            resumeAfterRef.current = true;
            session.pause();
        }
    };
    const release = (overlay: Overlay): void => {
        if (!openRef.current.delete(overlay)) return;
        if (openRef.current.size === 0 && resumeAfterRef.current) {
            resumeAfterRef.current = false;
            session.resume();
        }
    };

    // 何かを開いている間に読み込みが終わって動き出したら止め、全部閉じたときに再開する
    // （メニューで ROM を選んだあと、読み込み中にメニューを開き直した場合など）
    useEffect(() => {
        if (playing && openRef.current.size > 0) {
            resumeAfterRef.current = true;
            session.pause();
        }
    }, [playing]);

    // 一時停止ボタン。再開のときは、閉じた知らせが来ないまま残ったファイル選択も外す
    const togglePause = (): void => {
        resumeAfterRef.current = false;
        if (paused) {
            openRef.current.delete("romPicker");
            openRef.current.delete("statePicker");
            session.resume();
        } else {
            session.pause();
        }
    };

    useFilePickerClose(romInputRef, () => release("romPicker"));
    useFilePickerClose(loadStateRef, () => release("statePicker"));

    const openMenu = (): void => {
        if (menuOpen) return;
        hold("menu");
        setMenuOpen(true);
    };
    const closeMenu = (): void => {
        setMenuOpen(false);
        release("menu");
    };

    const openLoadConfirm = (source: "slot" | "file"): void => {
        hold("confirm");
        setConfirmingLoad(source);
    };
    const closeLoadConfirm = (): void => {
        setConfirmingLoad(null);
        release("confirm");
    };

    // クリックの中で呼ぶ（ファイル選択は利用者の操作の中でしか開けない）
    const pickFile = (picker: FilePicker): void => {
        const input = (picker === "romPicker" ? romInputRef : loadStateRef)
            .current;
        if (!input) return;
        hold(picker);
        input.click();
    };

    const openRomPicker = (): void => {
        // 選んだ ROM をすぐ始められるよう、このクリックの中で音を使えるようにしておく
        session.unlockAudio();
        pickFile("romPicker");
        closeMenu();
    };

    const handleRomChange = (): void => {
        const input = romInputRef.current;
        const file = input?.files?.[0];
        if (input) input.value = "";
        release("romPicker");
        if (file) void session.addRomFile(file);
    };

    const handleLoadStateChange = (): void => {
        const input = loadStateRef.current;
        const file = input?.files?.[0];
        if (input) input.value = "";
        if (file) {
            void session.loadState(file).finally(() => release("statePicker"));
        } else {
            release("statePicker");
        }
    };

    const selectRom = (id: string): void => {
        if (id !== currentRomId || !running) session.selectRom(id);
        closeMenu();
    };

    // 方向・A/B・SELECT/START。止まっている間の押下はコアに送らない（離すのは常に送る）。
    // 押している集合は覚えておき、再開したときに送り直す（一時停止でコア側のキーは全部離されるため）
    const pressedRef = useRef(new Set<GbButton>());
    const handleButtonDown = (button: GbButton): void => {
        pressedRef.current.add(button);
        if (playing) pressKey(button);
    };
    const handleButtonUp = (button: GbButton): void => {
        pressedRef.current.delete(button);
        releaseKey(button);
    };
    useEffect(() => {
        if (playing) pressedRef.current.forEach(button => pressKey(button));
    }, [playing]);

    // 操作の配置。切り替えたら、押している扱いのボタンを全部離す（前の配置の部品が消えても押しっぱなしにしない）
    const [controlLayout, setControlLayout] = useControlLayout();
    const selectControlLayout = (layout: ControlLayout): void => {
        if (layout === controlLayout) return;
        pressedRef.current.forEach(button => releaseKey(button));
        pressedRef.current.clear();
        setControlLayout(layout);
    };

    return (
        <>
            <GbcBody
                layout={controlLayout}
                screen={
                    <GameScreen
                        canvasRef={canvasRef}
                        playing={playing}
                        paused={paused}
                    />
                }
                screenOverlay={
                    status.kind === "running" &&
                    !session.notice &&
                    !session.flash &&
                    !showUpdateNotice ? null : (
                        <>
                            <ScreenMessage
                                status={status}
                                onStart={session.startReadyRom}
                                onAddRom={openRomPicker}
                                onOpenMenu={openMenu}
                            />
                            {session.flash && (
                                <div
                                    key={session.flash.key}
                                    className="gbc-flash"
                                    role="status"
                                >
                                    {session.flash.message}
                                </div>
                            )}
                            {session.notice && (
                                <div className="gbc-notice" role="alert">
                                    <span>{session.notice}</span>
                                    <button
                                        type="button"
                                        onClick={session.dismissNotice}
                                    >
                                        閉じる
                                    </button>
                                </div>
                            )}
                            {showUpdateNotice && (
                                <div className="gbc-notice gbc-update-notice">
                                    <span>新しい版があります</span>
                                    <button
                                        type="button"
                                        onClick={reloadToUpdate}
                                    >
                                        再読み込み
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setUpdateDismissed(true)}
                                    >
                                        あとで
                                    </button>
                                </div>
                            )}
                        </>
                    )
                }
                powerOn={running}
                paused={paused}
                gameActive={running}
                inert={menuOpen || confirmingLoad !== null}
                onTogglePause={togglePause}
                onSaveState={() => session.saveToSlot(canvasRef.current)}
                onLoadState={() => openLoadConfirm("slot")}
                canLoadState={
                    session.slot.kind === "saved" ||
                    session.slot.kind === "unreadable"
                }
                onOpenMenu={openMenu}
                onButtonDown={handleButtonDown}
                onButtonUp={handleButtonUp}
            />
            <MenuSheet open={menuOpen} onClose={closeMenu}>
                <RomMenu
                    roms={roms}
                    currentRomId={currentRomId}
                    busy={busy}
                    gameActive={running}
                    storageStatus={session.storageStatus}
                    appVersion={APP_VERSION}
                    updateReady={updateReady}
                    onReloadToUpdate={reloadToUpdate}
                    onSelectRom={selectRom}
                    onAddRom={openRomPicker}
                    onExportState={session.exportStateFile}
                    onImportState={() => {
                        // 確認を先に開いてからメニューを閉じる（その間に再開しないように）
                        openLoadConfirm("file");
                        closeMenu();
                    }}
                    controlLayout={controlLayout}
                    onSelectControlLayout={selectControlLayout}
                />
            </MenuSheet>
            <LoadStateConfirm
                open={confirmingLoad !== null}
                slot={
                    confirmingLoad === "slot" && session.slot.kind === "saved"
                        ? session.slot
                        : undefined
                }
                onConfirm={() => {
                    if (confirmingLoad === "slot") {
                        void session.loadFromSlot();
                    } else {
                        // ファイル選択を先に開いてから確認を閉じる（その間に再開しないように）
                        pickFile("statePicker");
                    }
                    closeLoadConfirm();
                }}
                onCancel={closeLoadConfirm}
            />
            {/* accept は付けない（iOS は .gb / .gbc / .rbs を知らず、ファイルを選べなくなることがある） */}
            <input
                ref={romInputRef}
                type="file"
                hidden
                onChange={handleRomChange}
            />
            <input
                ref={loadStateRef}
                type="file"
                hidden
                onChange={handleLoadStateChange}
            />
        </>
    );
};

export default App;
