import { useRef } from "react";

import type { GbButton, GbButtonHandlers } from "./buttons";
import { type HitTest, usePointerButtons } from "./usePointerButtons";

// 中心からこの距離（px）までは、どの方向も入らない（遊び）
const DEAD_ZONE = 14;
// 指が中心からこれ（px）より離れると、中心が指についてくる
const MAX_RADIUS = 44;
// 斜めとみなす角度の幅（度）。狭めにして、上下左右だけを入れたいときに斜めが入りにくくする
const DIAGONAL_DEG = 30;

const ARROWS = ["Up", "Right", "Down", "Left"] as const;

const toButtons = (dx: number, dy: number): GbButton[] => {
    if (Math.hypot(dx, dy) < DEAD_ZONE) return [];
    // 横軸からの角度（0〜90 度）で、横・縦・斜めを決める
    const fromHorizontal =
        (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
    const edge = 45 - DIAGONAL_DEG / 2;
    const buttons: GbButton[] = [];
    if (fromHorizontal < 90 - edge) buttons.push(dx > 0 ? "Right" : "Left");
    if (fromHorizontal > edge) buttons.push(dy > 0 ? "Down" : "Up");
    return buttons;
};

// 見た目（中心・指の丸・その間の伸び）は、指の動きのたびに React を通さず CSS 変数で動かす
const show = (
    element: HTMLElement,
    ox: number,
    oy: number,
    dx: number,
    dy: number,
) => {
    const { style } = element;
    style.setProperty("--puni-ox", `${ox}px`);
    style.setProperty("--puni-oy", `${oy}px`);
    style.setProperty("--puni-dx", `${dx}px`);
    style.setProperty("--puni-dy", `${dy}px`);
    style.setProperty("--puni-dist", `${Math.hypot(dx, dy)}px`);
    style.setProperty("--puni-angle", `${Math.atan2(dy, dx)}rad`);
};

/**
 * 1 本目の指で触った所が中心になる。
 * 2 本目以降の指は無視する（ぷにコンは 1 本の指で操作するもののため）。
 */
const hitTest: HitTest = (x, y, _rect, element, { id, memo }) => {
    const owner = element.dataset.puniPointer;
    if (memo.ox === undefined) {
        if (owner !== undefined) return [];
        element.dataset.puniPointer = String(id);
        memo.ox = x;
        memo.oy = y;
    }

    let dx = x - memo.ox;
    let dy = y - memo.oy;
    const distance = Math.hypot(dx, dy);
    if (distance > MAX_RADIUS) {
        // 中心を指の方へ引っぱる（向きはそのまま、距離は MAX_RADIUS に保つ）
        dx = (dx / distance) * MAX_RADIUS;
        dy = (dy / distance) * MAX_RADIUS;
        memo.ox = x - dx;
        memo.oy = y - dy;
    }

    show(element, memo.ox, memo.oy, dx, dy);
    return toButtons(dx, dy);
};

const handlePointerEnd = (element: HTMLElement, pointerId: number) => {
    if (element.dataset.puniPointer === String(pointerId)) {
        delete element.dataset.puniPointer;
    }
};

/**
 * ぷにコン（方向の入力）。領域のどこを触っても、触った所が中心になる。
 * 指をずらした向きを 8 方向に割り当てる。指を離さずに回して方向を変えられる。
 */
export const PuniPad = (handlers: GbButtonHandlers) => {
    const ref = useRef<HTMLDivElement>(null);
    const pressed = usePointerButtons(ref, hitTest, handlers, {
        onPointerEnd: handlePointerEnd,
    });

    return (
        <div ref={ref} className="gbc-puni" aria-label="方向の操作（ぷにコン）">
            <div className="gbc-puni-hint" aria-hidden="true">
                {ARROWS.map(direction => (
                    <span
                        key={direction}
                        className={`gbc-puni-arrow gbc-puni-${direction.toLowerCase()}`}
                    />
                ))}
            </div>
            <div className="gbc-puni-base" aria-hidden="true">
                {ARROWS.map(direction => (
                    <span
                        key={direction}
                        className={`gbc-puni-arrow gbc-puni-${direction.toLowerCase()}`}
                        data-pressed={pressed.has(direction) || undefined}
                    />
                ))}
            </div>
            <div className="gbc-puni-stretch" aria-hidden="true" />
            <div className="gbc-puni-knob" aria-hidden="true" />
        </div>
    );
};

export default PuniPad;
