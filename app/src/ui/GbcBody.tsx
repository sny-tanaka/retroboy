import "./gbc.css";

import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";

import { ActionButtons } from "./ActionButtons";
import type { GbButtonHandlers } from "./buttons";
import { PuniPad } from "./PuniPad";
import { StartSelect } from "./StartSelect";
import { useScreenSize } from "./useScreenSize";

// gbc.css と共有する寸法（px）。ゲーム画面の大きさの計算に使う
const BEZEL_PAD_X = 10;
const BEZEL_PAD_TOP = 18;
const STRIP_HEIGHT = 52;
const BODY_GAP = 8;
// ぷにコン・A/B・SELECT/START に最低限取っておく高さ
const CONTROLS_MIN_HEIGHT = 236;

const RESERVE = {
    width: BEZEL_PAD_X * 2,
    height: BEZEL_PAD_TOP + STRIP_HEIGHT + BODY_GAP + CONTROLS_MIN_HEIGHT,
};

export interface GbcBodyProps extends GbButtonHandlers {
    /** ゲーム画面。160x144 の canvas を入れる。大きさは枠のほうで合わせる */
    readonly screen: ReactNode;
    /** 画面の上に重ねるもの（「タップして開始」など） */
    readonly screenOverlay?: ReactNode;
    readonly powerOn: boolean;
    readonly paused: boolean;
    /** false のとき、一時停止・セーブ・ロードを押せなくする（ゲームが動いていないとき）。既定は true */
    readonly gameActive?: boolean;
    readonly onTogglePause: () => void;
    readonly onSaveState: () => void;
    /** 「ロード」を押した。上書きの確認（ConfirmDialog）は呼ぶ側で出す */
    readonly onLoadState: () => void;
    /** false のとき「ロード」を押せなくする（セーブが無いとき）。既定は true */
    readonly canLoadState?: boolean;
    readonly onOpenMenu: () => void;
    /** メニューや確認を開いている間は true にして、本体を操作できなくする（Tab でも届かない） */
    readonly inert?: boolean;
}

const MenuIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
);
const PauseIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 6v12M15 6v12" />
    </svg>
);
const PlayIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5.5v13l10.5-6.5z" className="gbc-icon-fill" />
    </svg>
);
const SaveIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4v10M7.5 9.5 12 14l4.5-4.5M5 19h14" />
    </svg>
);
const LoadIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 14V4M7.5 8.5 12 4l4.5 4.5M5 19h14" />
    </svg>
);

/**
 * iOS の長押しメニュー・ダブルタップ拡大・ピンチ拡大・引っぱりスクロールを止める。
 * CSS（touch-action など）だけでは止まらないものをここで止める。
 */
const useBlockIosGestures = () => {
    useEffect(() => {
        const prevent = (event: Event) => event.preventDefault();
        const preventMultiTouch = (event: TouchEvent) => {
            if (event.touches.length > 1) event.preventDefault();
        };
        document.addEventListener("gesturestart", prevent);
        document.addEventListener("contextmenu", prevent);
        document.addEventListener("dblclick", prevent);
        document.addEventListener("touchmove", preventMultiTouch, {
            passive: false,
        });
        return () => {
            document.removeEventListener("gesturestart", prevent);
            document.removeEventListener("contextmenu", prevent);
            document.removeEventListener("dblclick", prevent);
            document.removeEventListener("touchmove", preventMultiTouch);
        };
    }, []);
};

/** ゲームボーイカラー風の本体。ゲームの処理には繋がず、押した・離したを props で返すだけ。 */
export const GbcBody = ({
    screen,
    screenOverlay,
    powerOn,
    paused,
    onTogglePause,
    onSaveState,
    onLoadState,
    canLoadState = true,
    onOpenMenu,
    inert = false,
    gameActive = true,
    onButtonDown,
    onButtonUp,
}: GbcBodyProps) => {
    useBlockIosGestures();
    const bodyRef = useRef<HTMLDivElement>(null);
    const screenSize = useScreenSize(bodyRef, RESERVE);
    const handlers = { onButtonDown, onButtonUp };

    const style = {
        "--gbc-bezel-pad-x": `${BEZEL_PAD_X}px`,
        "--gbc-bezel-pad-top": `${BEZEL_PAD_TOP}px`,
        "--gbc-strip-height": `${STRIP_HEIGHT}px`,
        "--gbc-body-gap": `${BODY_GAP}px`,
        "--gbc-controls-min-height": `${CONTROLS_MIN_HEIGHT}px`,
    } as CSSProperties;

    return (
        <div className="gbc-stage" style={style} inert={inert}>
            <div ref={bodyRef} className="gbc-body">
                <span className="gbc-screw gbc-screw-1" />
                <span className="gbc-screw gbc-screw-2" />
                <span className="gbc-screw gbc-screw-3" />
                <span className="gbc-screw gbc-screw-4" />

                <section className="gbc-bezel">
                    <span
                        className="gbc-power"
                        data-on={powerOn || undefined}
                        role="img"
                        aria-label={powerOn ? "電源オン" : "電源オフ"}
                    >
                        <span className="gbc-power-lamp" />
                        POWER
                    </span>
                    <div
                        className="gbc-screen"
                        style={{
                            width: `${screenSize.width}px`,
                            height: `${screenSize.height}px`,
                        }}
                    >
                        {screen}
                        {paused && (
                            <div className="gbc-screen-overlay gbc-paused">
                                一時停止中
                            </div>
                        )}
                        {screenOverlay && (
                            <div className="gbc-screen-overlay">
                                {screenOverlay}
                            </div>
                        )}
                    </div>
                    <div className="gbc-strip">
                        <button
                            type="button"
                            className="gbc-sub-button"
                            onClick={onOpenMenu}
                        >
                            <MenuIcon />
                            メニュー
                        </button>
                        <button
                            type="button"
                            className="gbc-sub-button"
                            onClick={onTogglePause}
                            aria-pressed={paused}
                            disabled={!gameActive}
                        >
                            {paused ? <PlayIcon /> : <PauseIcon />}
                            {paused ? "再開" : "一時停止"}
                        </button>
                        <span className="gbc-strip-spacer" />
                        <button
                            type="button"
                            className="gbc-sub-button gbc-state-button"
                            onClick={onSaveState}
                            disabled={!gameActive}
                        >
                            <SaveIcon />
                            セーブ
                        </button>
                        <button
                            type="button"
                            className="gbc-sub-button gbc-state-button"
                            onClick={onLoadState}
                            disabled={!gameActive || !canLoadState}
                        >
                            <LoadIcon />
                            ロード
                        </button>
                    </div>
                </section>

                <section className="gbc-controls">
                    <span className="gbc-engraving" aria-hidden="true">
                        Retro Boy Snap
                    </span>
                    <div className="gbc-puni-area">
                        <PuniPad {...handlers} />
                    </div>
                    <div className="gbc-ab-area">
                        <ActionButtons {...handlers} />
                    </div>
                    <div className="gbc-start-select-area">
                        <StartSelect {...handlers} />
                    </div>
                </section>
            </div>
        </div>
    );
};

export default GbcBody;
