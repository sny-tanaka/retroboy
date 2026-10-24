import { useEffect, useRef, useState } from "react";

import type { GbButton } from "../buttons";
import { LoadStateConfirm, type SavedSlotInfo } from "../ConfirmDialog";
import { parseControlLayout, useControlLayout } from "../controlLayout";
import { ControlLayoutMenu } from "../ControlLayoutMenu";
import { GbcBody } from "../GbcBody";
import type { GestureBTrigger } from "../GestureControls";
import { MenuSheet } from "../MenuSheet";
import { GB_HEIGHT, GB_WIDTH } from "../useScreenSize";

const ORDER: GbButton[] = [
    "Up",
    "Down",
    "Left",
    "Right",
    "B",
    "A",
    "Select",
    "Start",
];

// ゲーム画面の代わりに、押されているボタンとドットのくっきり具合が分かる絵を描く
const draw = (
    context: CanvasRenderingContext2D,
    pressed: ReadonlySet<GbButton>,
    lastAction: string,
) => {
    context.fillStyle = "#1b2a1f";
    context.fillRect(0, 0, GB_WIDTH, GB_HEIGHT);

    // 1 ドットの市松模様（ぼけていれば灰色に見える）
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            context.fillStyle = (x + y) % 2 ? "#9bbc0f" : "#0f380f";
            context.fillRect(4 + x, 4 + y, 1, 1);
        }
    }
    // 色の帯
    ["#e04040", "#f0a020", "#f0e040", "#40c060", "#4080f0", "#a050e0"].forEach(
        (color, i) => {
            context.fillStyle = color;
            context.fillRect(26 + i * 22, 4, 22, 16);
        },
    );

    context.fillStyle = "#cfe8b0";
    context.font = "8px monospace";
    context.textBaseline = "top";
    context.fillText("UI PREVIEW", 4, 26);

    ORDER.forEach((button, i) => {
        const x = 4 + (i % 4) * 39;
        const y = 44 + Math.floor(i / 4) * 22;
        const on = pressed.has(button);
        context.fillStyle = on ? "#9bbc0f" : "#2c3e2f";
        context.fillRect(x, y, 36, 18);
        context.fillStyle = on ? "#0f380f" : "#6d8a6a";
        context.fillText(button.toUpperCase(), x + 3, y + 5);
    });

    context.fillStyle = "#cfe8b0";
    context.fillText(`LAST: ${lastAction}`, 4, 96);
    context.fillText(`DPR ${window.devicePixelRatio}`, 4, 110);

    // 8 方向のどれが入っているか（3x3 のマス。真ん中は何も入っていない）
    const col = (pressed.has("Right") ? 1 : 0) - (pressed.has("Left") ? 1 : 0);
    const row = (pressed.has("Down") ? 1 : 0) - (pressed.has("Up") ? 1 : 0);
    for (let r = -1; r <= 1; r++) {
        for (let c = -1; c <= 1; c++) {
            context.fillStyle = r === row && c === col ? "#9bbc0f" : "#2c3e2f";
            context.fillRect(124 + (c + 1) * 11, 98 + (r + 1) * 11, 10, 10);
        }
    }
};

// 操作の配置はメニューで切り替える（アプリと同じく覚える）。?layout=twohand|onehand-a|onehand-b でも開ける。
// ?b=both|hold|second-finger で片手 B の B の入れ方、?reach=1 で親指の届く範囲の目安を重ねる
const params = new URLSearchParams(location.search);
const initialLayout = parseControlLayout(params.get("layout"));
const B_TRIGGERS: readonly GestureBTrigger[] = [
    "both",
    "hold",
    "second-finger",
];
const bTrigger = B_TRIGGERS.find(v => v === params.get("b")) ?? "both";
const showReach = params.get("reach") === "1";

/**
 * 右手の親指の届く範囲の目安。画面の右下の角を中心に、楽に届く（半径 R_EASY）と、伸ばせば届く（R_STRETCH）。
 * 390x844 の iPhone を右手で持ったときの目安で、手の大きさや持ち方で変わる。
 */
const R_EASY = 250;
const R_STRETCH = 330;
const ThumbReach = () => (
    <div
        aria-hidden="true"
        style={{
            position: "fixed",
            inset: 0,
            zIndex: 5,
            pointerEvents: "none",
            background: [
                `radial-gradient(circle ${R_EASY}px at 100% 100%, rgba(80, 230, 160, 0.20) 0 ${R_EASY - 2}px, rgba(80, 230, 160, 0.75) ${R_EASY - 1}px ${R_EASY}px, transparent ${R_EASY + 1}px)`,
                `radial-gradient(circle ${R_STRETCH}px at 100% 100%, rgba(240, 200, 80, 0.10) 0 ${R_STRETCH - 2}px, rgba(240, 200, 80, 0.6) ${R_STRETCH - 1}px ${R_STRETCH}px, transparent ${R_STRETCH + 1}px)`,
            ].join(", "),
        }}
    />
);

export const Preview = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [pressed, setPressed] = useState<ReadonlySet<GbButton>>(new Set());
    const [lastAction, setLastAction] = useState("-");
    const [paused, setPaused] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmingLoad, setConfirmingLoad] = useState(false);
    const [layout, setLayout] = useControlLayout(initialLayout);
    // 「セーブ」を押したときの日時と画面（アプリと同じく、ロードの確認に出す）
    const [saved, setSaved] = useState<SavedSlotInfo>();

    useEffect(() => {
        const context = canvasRef.current?.getContext("2d");
        if (context) draw(context, pressed, lastAction);
    }, [pressed, lastAction]);

    return (
        <>
            <GbcBody
                layout={layout}
                gestureBTrigger={bTrigger}
                inert={menuOpen || confirmingLoad}
                powerOn={!paused}
                paused={paused}
                screen={
                    <canvas
                        ref={canvasRef}
                        width={GB_WIDTH}
                        height={GB_HEIGHT}
                    />
                }
                onButtonDown={button => {
                    setPressed(prev => new Set(prev).add(button));
                    setLastAction(`PRESS ${button.toUpperCase()}`);
                }}
                onButtonUp={button => {
                    setPressed(prev => {
                        const next = new Set(prev);
                        next.delete(button);
                        return next;
                    });
                    setLastAction(`RELEASE ${button.toUpperCase()}`);
                }}
                onTogglePause={() => {
                    setPaused(prev => !prev);
                    setLastAction("PAUSE");
                }}
                onSaveState={() => {
                    const savedAt = Date.now();
                    canvasRef.current?.toBlob(screenshot =>
                        setSaved({
                            savedAt,
                            screenshot: screenshot ?? undefined,
                        }),
                    );
                    setLastAction("SAVE STATE");
                }}
                onLoadState={() => setConfirmingLoad(true)}
                onOpenMenu={() => {
                    setMenuOpen(true);
                    setLastAction("MENU");
                }}
            />
            {showReach && <ThumbReach />}
            <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)}>
                <p style={{ color: "#9a94b0" }}>
                    ここに ROM の選択・切り替えなどが入ります。
                </p>
                <ControlLayoutMenu value={layout} onChange={setLayout} />
            </MenuSheet>
            <LoadStateConfirm
                open={confirmingLoad}
                slot={saved}
                onConfirm={() => {
                    setConfirmingLoad(false);
                    setLastAction("LOAD STATE");
                }}
                onCancel={() => setConfirmingLoad(false)}
            />
        </>
    );
};

export default Preview;
