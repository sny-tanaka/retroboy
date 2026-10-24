import { type RefObject, useEffect, useRef, useState } from "react";

import type { GbButton, GbButtonHandlers } from "./buttons";
import { hitRoundButtons } from "./ActionButtons";
import { PUNI_SIZE, PuniVisual, trackPuni } from "./PuniPad";
import { usePointerButtons } from "./usePointerButtons";

// 触った所からこの距離（px）より動いたら「なぞる」（方向）。それまでは「タップ」か「長押し」の候補
const SLOP = 10;
// 動かさずにこの時間（ms）触り続けたら「長押し」（B を押し、離すまで押したまま）
const LONG_PRESS_MS = 280;
// タップの A を押しておく時間（ms）。ゲームは 1 コマ（約 17ms）ごとに読むので、数コマ分は押しておく
const TAP_A_MS = 90;
// 前のタップの A を離してから次の A を押すまでの間（ms）。続けて押したのが 1 回にまとまらないように
const TAP_A_GAP_MS = 40;

/** B の入れ方。既定は both（長押しともう 1 本の指の両方）。ほかはプレビューで比べる用 */
export type GestureBTrigger = "both" | "hold" | "second-finger";

type Mode = "pending" | "drag" | "hold";

interface Primary {
    readonly id: number;
    readonly x: number;
    readonly y: number;
    mode: Mode;
    timer: number;
    directions: GbButton[];
    readonly memo: Record<string, number>;
}

const sameSet = (a: ReadonlySet<GbButton>, b: ReadonlySet<GbButton>) =>
    a.size === b.size && [...a].every(button => b.has(button));

/**
 * 画面の下半分のどこでも使える、ジェスチャーの操作面。
 * - なぞる: 方向（ぷにコンと同じ判定。触った所が中心で、離れすぎると中心が指についてくる）
 * - タップ: A（離したときに TAP_A_MS だけ押す）
 * - 長押し、またはもう 1 本の指で触る: B（離すまで押したまま）
 * usePointerButtons と同じく、捕まえた指を外へ滑らせても追い、アプリを離れたら全部離す。
 */
const useGestures = (
    ref: RefObject<HTMLElement | null>,
    bTrigger: GestureBTrigger,
    { onButtonDown, onButtonUp }: GbButtonHandlers,
): ReadonlySet<GbButton> => {
    const [pressed, setPressed] = useState<ReadonlySet<GbButton>>(new Set());

    const latest = useRef({ bTrigger, onButtonDown, onButtonUp });
    useEffect(() => {
        latest.current = { bTrigger, onButtonDown, onButtonUp };
    });

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        let primary: Primary | undefined;
        const secondaries = new Set<number>();
        let tapA = false;
        let tapTimer = 0;
        let current: ReadonlySet<GbButton> = new Set();

        const update = () => {
            const next = new Set<GbButton>(primary?.directions ?? []);
            if (primary?.mode === "hold" || secondaries.size > 0) next.add("B");
            if (tapA) next.add("A");
            if (sameSet(current, next)) return;
            const { onButtonDown, onButtonUp } = latest.current;
            current.forEach(button => {
                if (!next.has(button)) onButtonUp(button);
            });
            next.forEach(button => {
                if (!current.has(button)) onButtonDown(button);
            });
            current = next;
            setPressed(next);
        };

        const local = (event: PointerEvent) => {
            const rect = element.getBoundingClientRect();
            return {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
            };
        };

        const showMode = () => {
            if (primary) {
                element.dataset.gesture = primary.mode;
                element.style.setProperty("--gesture-x", `${primary.x}px`);
                element.style.setProperty("--gesture-y", `${primary.y}px`);
            } else {
                delete element.dataset.gesture;
            }
            if (primary?.mode === "drag") {
                element.dataset.puniPointer = String(primary.id);
            } else {
                delete element.dataset.puniPointer;
            }
        };

        const showTap = (x: number, y: number) => {
            // 同じ属性を付け直してもアニメーションは始め直さないので、一度外して描き直させる
            delete element.dataset.tap;
            void element.offsetWidth;
            element.style.setProperty("--tap-x", `${x}px`);
            element.style.setProperty("--tap-y", `${y}px`);
            element.dataset.tap = "";
        };

        const tap = () => {
            window.clearTimeout(tapTimer);
            const press = () => {
                tapA = true;
                update();
                tapTimer = window.setTimeout(() => {
                    tapA = false;
                    update();
                }, TAP_A_MS);
            };
            if (tapA) {
                tapA = false;
                update();
                tapTimer = window.setTimeout(press, TAP_A_GAP_MS);
            } else {
                press();
            }
        };

        const handleDown = (event: PointerEvent) => {
            event.preventDefault();
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // 合成したイベントなど、もう離れた指は捕まえられない。追いかけないだけで押した判定はする
            }
            if (primary) {
                if (latest.current.bTrigger !== "hold") {
                    secondaries.add(event.pointerId);
                    update();
                }
                return;
            }
            const { x, y } = local(event);
            const id = event.pointerId;
            primary = {
                id,
                x,
                y,
                mode: "pending",
                timer: 0,
                directions: [],
                memo: {},
            };
            if (latest.current.bTrigger !== "second-finger") {
                primary.timer = window.setTimeout(() => {
                    if (primary?.id !== id || primary.mode !== "pending")
                        return;
                    primary.mode = "hold";
                    showMode();
                    update();
                }, LONG_PRESS_MS);
            }
            showMode();
        };

        const handleMove = (event: PointerEvent) => {
            if (!primary || primary.id !== event.pointerId) return;
            const { x, y } = local(event);
            if (primary.mode === "pending") {
                if (Math.hypot(x - primary.x, y - primary.y) <= SLOP) return;
                window.clearTimeout(primary.timer);
                primary.mode = "drag";
                // 触り始めた所を中心にする
                primary.memo.ox = primary.x;
                primary.memo.oy = primary.y;
                showMode();
            }
            if (primary.mode !== "drag") return;
            primary.directions = trackPuni(
                x,
                y,
                element,
                primary.memo,
                PUNI_SIZE,
            );
            update();
        };

        const endPrimary = (tapped: boolean) => {
            if (!primary) return;
            window.clearTimeout(primary.timer);
            const { x, y } = primary;
            primary = undefined;
            showMode();
            if (tapped) {
                showTap(x, y);
                tap();
            }
        };

        const handleUp = (event: PointerEvent) => {
            if (secondaries.delete(event.pointerId)) {
                update();
                return;
            }
            if (primary?.id !== event.pointerId) return;
            // 取り消された指（pointercancel など）はタップにしない
            endPrimary(
                event.type === "pointerup" && primary.mode === "pending",
            );
            update();
        };

        const releaseAll = () => {
            endPrimary(false);
            secondaries.clear();
            window.clearTimeout(tapTimer);
            tapA = false;
            update();
        };
        const handleVisibility = () => {
            if (document.hidden) releaseAll();
        };

        element.addEventListener("pointerdown", handleDown);
        element.addEventListener("pointermove", handleMove);
        element.addEventListener("pointerup", handleUp);
        element.addEventListener("pointercancel", handleUp);
        element.addEventListener("lostpointercapture", handleUp);
        window.addEventListener("blur", releaseAll);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            element.removeEventListener("pointerdown", handleDown);
            element.removeEventListener("pointermove", handleMove);
            element.removeEventListener("pointerup", handleUp);
            element.removeEventListener("pointercancel", handleUp);
            element.removeEventListener("lostpointercapture", handleUp);
            window.removeEventListener("blur", releaseAll);
            document.removeEventListener("visibilitychange", handleVisibility);
            releaseAll();
        };
    }, []);

    return pressed;
};

/** 右下の小さな SELECT と START。間を空けて置き、両方が同時に入らないようにする */
const CornerStartSelect = (handlers: GbButtonHandlers) => {
    const ref = useRef<HTMLDivElement>(null);
    const pressed = usePointerButtons(ref, hitRoundButtons, handlers);

    return (
        <div ref={ref} className="gbc-onehand-b-start-select">
            {(["Select", "Start"] as const).map(button => (
                <span
                    key={button}
                    data-button={button}
                    data-reach="1"
                    className="gbc-onehand-pill"
                >
                    <span
                        className="gbc-pill"
                        data-pressed={pressed.has(button) || undefined}
                    />
                    <span className="gbc-pill-label">
                        {button.toUpperCase()}
                    </span>
                </span>
            ))}
        </div>
    );
};

export interface GestureControlsProps extends GbButtonHandlers {
    readonly bTrigger?: GestureBTrigger;
}

/**
 * 片手 B「ジェスチャー」（右手で持つ）。操作部のどこでも、なぞる＝方向・タップ＝A・長押し（か 2 本目の指）＝B。
 * START・SELECT だけは右下の小さなボタン。
 */
export const GestureControls = ({
    bTrigger = "both",
    ...handlers
}: GestureControlsProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const pressed = useGestures(ref, bTrigger, handlers);

    const hints = [
        "なぞる＝方向",
        "タップ＝A",
        bTrigger === "hold"
            ? "長押し＝B"
            : bTrigger === "second-finger"
              ? "もう 1 本の指＝B"
              : "長押し／もう 1 本の指＝B",
    ];

    return (
        <div className="gbc-onehand-b">
            <div
                ref={ref}
                className="gbc-puni gbc-gesture"
                aria-label="ジェスチャーの操作面（なぞる＝方向、タップ＝A、長押し＝B）"
            >
                <PuniVisual pressed={pressed} />
                <ul className="gbc-gesture-hints" aria-hidden="true">
                    {hints.map(hint => (
                        <li key={hint}>{hint}</li>
                    ))}
                </ul>
                <span className="gbc-gesture-ring" aria-hidden="true">
                    B
                </span>
                <span className="gbc-gesture-tap" aria-hidden="true">
                    A
                </span>
                <span
                    className="gbc-gesture-badge"
                    data-on={pressed.has("A") || undefined}
                    aria-hidden="true"
                >
                    A
                </span>
                <span
                    className="gbc-gesture-badge gbc-gesture-badge-b"
                    data-on={pressed.has("B") || undefined}
                    aria-hidden="true"
                >
                    B
                </span>
            </div>
            <CornerStartSelect {...handlers} />
        </div>
    );
};

export default GestureControls;
