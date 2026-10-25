import "./gbc.css";

import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";

import { ActionButtons } from "./ActionButtons";
import type { GbButtonHandlers } from "./buttons";
import type { ControlLayout } from "./controlLayout";
import { type GestureBTrigger, GestureControls } from "./GestureControls";
import { OneHandCluster } from "./OneHandCluster";
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
    /** 操作部の配置。既定は twohand */
    readonly layout?: ControlLayout;
    /** 片手 B の B の入れ方（プレビューで比べる用）。既定は both（長押しともう 1 本の指の両方） */
    readonly gestureBTrigger?: GestureBTrigger;
    /** ゲーム画面。160x144 の canvas を入れる。大きさは枠のほうで合わせる */
    readonly screen: ReactNode;
    /** 画面の上に重ねるもの（「タップして開始」など） */
    readonly screenOverlay?: ReactNode;
    readonly powerOn: boolean;
    readonly paused: boolean;
    /** false のとき、倍速・セーブ・ロードを押せなくする（ゲームが動いていないとき）。既定は true */
    readonly gameActive?: boolean;
    /** いまの速さ（1 / 1.5 / 2）。倍速ボタンに出す */
    readonly speed: number;
    /** 倍速ボタンを押した（×1 → ×1.5 → ×2 → ×1） */
    readonly onCycleSpeed: () => void;
    /** 通信ケーブルでつないでいる間に、倍速ボタンの代わりに出す文言（「通信中 8ms」など）。この間は ×1 で押せない */
    readonly linkLabel?: string;
    /** 「一時停止中」の画面を押した（再開する） */
    readonly onResume: () => void;
    readonly onSaveState: () => void;
    /** 「ロード」を押した。上書きの確認（ConfirmDialog）は呼ぶ側で出す */
    readonly onLoadState: () => void;
    /** false のとき「ロード」を押せなくする（セーブが無いとき）。既定は true */
    readonly canLoadState?: boolean;
    readonly onOpenMenu: () => void;
    /** メニューや確認を開いている間は true にして、本体を操作できなくする（Tab でも届かない） */
    readonly inert?: boolean;
}

const LinkIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
        <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
);

const MenuIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
);
const FastForwardIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
            d="M3 6v12l8.5-6zM12 6v12l8.5-6z"
            className="gbc-icon-fill"
        />
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
    layout = "twohand",
    gestureBTrigger,
    screen,
    screenOverlay,
    powerOn,
    paused,
    speed,
    onCycleSpeed,
    linkLabel,
    onResume,
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
                            <button
                                type="button"
                                className="gbc-screen-overlay gbc-paused"
                                onClick={onResume}
                            >
                                <span>一時停止中</span>
                                <span className="gbc-paused-sub">
                                    タップで再開
                                </span>
                            </button>
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
                        {linkLabel ? (
                            <span
                                className="gbc-sub-button gbc-link-label"
                                role="status"
                                aria-label={`${linkLabel}（通信中は ×1）`}
                            >
                                <LinkIcon />
                                {linkLabel}
                            </span>
                        ) : (
                            <button
                                type="button"
                                className="gbc-sub-button gbc-speed-button"
                                onClick={onCycleSpeed}
                                data-fast={speed !== 1 || undefined}
                                aria-label={`速さ ×${speed}（押すと切り替え）`}
                                disabled={!gameActive}
                            >
                                <FastForwardIcon />
                                <span className="gbc-speed-value">
                                    ×{speed}
                                </span>
                            </button>
                        )}
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

                <section className="gbc-controls" data-layout={layout}>
                    <span className="gbc-engraving" aria-hidden="true">
                        Retro Boy Snap
                    </span>
                    {layout === "onehand-a" ? (
                        <OneHandCluster {...handlers} />
                    ) : layout === "onehand-b" ? (
                        <GestureControls
                            {...handlers}
                            bTrigger={gestureBTrigger}
                        />
                    ) : (
                        <>
                            <div className="gbc-puni-area">
                                <PuniPad {...handlers} />
                            </div>
                            <div className="gbc-ab-area">
                                <ActionButtons {...handlers} />
                            </div>
                            <div className="gbc-start-select-area">
                                <StartSelect {...handlers} />
                            </div>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
};

export default GbcBody;
