import { type RefObject, useEffect, useRef, useState } from "react";

import type { GbButton, GbButtonHandlers } from "./buttons";

// 1 本の指について、触ってから離すまで持ち回る情報。memo は hitTest が自由に使う（ぷにコンの中心など）
export interface PointerState {
    readonly id: number;
    readonly memo: Record<string, number>;
}

// 要素の左上を原点にした指の位置から、押されているボタンを返す
export type HitTest = (
    x: number,
    y: number,
    rect: DOMRect,
    element: HTMLElement,
    pointer: PointerState,
) => GbButton[];

interface Options {
    /** 指が離れたとき（離した・取り消された・アプリを離れた）に呼ぶ */
    readonly onPointerEnd?: (element: HTMLElement, pointerId: number) => void;
}

const sameSet = (a: ReadonlySet<GbButton>, b: ReadonlySet<GbButton>) =>
    a.size === b.size && [...a].every(button => b.has(button));

/**
 * 1 つの要素の上の指（pointer）を追いかけて、押されているボタンの集合を作る。
 * - pointerdown で setPointerCapture するので、指が要素の外へ滑っても追い続ける（ぷにコンの方向転換・B→A の滑らせ）。
 * - 指ごとに hitTest するので、2 本指の同時押しも、1 本指で B と A の間を押す同時押しもできる。
 * - 指ごとの状態（PointerState）を hitTest に渡すので、触り始めの位置に応じた判定もできる（ぷにコン）。
 * - 集合が変わったときだけ、増えたボタンに onButtonDown、減ったボタンに onButtonUp を呼ぶ。
 */
export const usePointerButtons = (
    ref: RefObject<HTMLElement | null>,
    hitTest: HitTest,
    { onButtonDown, onButtonUp }: GbButtonHandlers,
    { onPointerEnd }: Options = {},
): ReadonlySet<GbButton> => {
    const [pressed, setPressed] = useState<ReadonlySet<GbButton>>(new Set());

    // イベントハンドラーは一度だけ登録するので、最新の値は ref から読む
    const latest = useRef({ hitTest, onButtonDown, onButtonUp, onPointerEnd });
    useEffect(() => {
        latest.current = { hitTest, onButtonDown, onButtonUp, onPointerEnd };
    });

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        const pointers = new Map<
            number,
            { buttons: GbButton[]; state: PointerState }
        >();
        let current: ReadonlySet<GbButton> = new Set();

        const update = () => {
            const next = new Set(
                [...pointers.values()].flatMap(pointer => pointer.buttons),
            );
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

        const track = (event: PointerEvent) => {
            const rect = element.getBoundingClientRect();
            const state = pointers.get(event.pointerId)?.state ?? {
                id: event.pointerId,
                memo: {},
            };
            const buttons = latest.current.hitTest(
                event.clientX - rect.left,
                event.clientY - rect.top,
                rect,
                element,
                state,
            );
            pointers.set(event.pointerId, { buttons, state });
            update();
        };

        const handleDown = (event: PointerEvent) => {
            event.preventDefault();
            try {
                element.setPointerCapture(event.pointerId);
            } catch {
                // 合成したイベントなど、もう離れた指は捕まえられない。追いかけないだけで押した判定はする
            }
            track(event);
        };
        const handleMove = (event: PointerEvent) => {
            if (pointers.has(event.pointerId)) track(event);
        };
        const end = (pointerId: number) => {
            pointers.delete(pointerId);
            latest.current.onPointerEnd?.(element, pointerId);
        };
        const handleUp = (event: PointerEvent) => {
            if (!pointers.has(event.pointerId)) return;
            end(event.pointerId);
            update();
        };
        const releaseAll = () => {
            [...pointers.keys()].forEach(end);
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
        // アプリを離れると pointerup が来ないことがあるので、押しっぱなしにならないよう全部離す
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
