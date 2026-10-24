import { useRef } from "react";

import type { GbButton, GbButtonHandlers } from "./buttons";
import { type HitTest, usePointerButtons } from "./usePointerButtons";

export interface PuniSize {
    /** 中心からこの距離（px）までは、どの方向も入らない（遊び） */
    readonly deadZone: number;
    /** 指が中心からこれ（px）より離れると、中心が指についてくる */
    readonly maxRadius: number;
}

// 両手の配置のぷにコン。gbc.css の --puni-radius と同じ
export const PUNI_SIZE: PuniSize = { deadZone: 14, maxRadius: 44 };
// 片手の配置の小さめのぷにコン。gbc.css の .gbc-puni-compact の --puni-radius と同じ
export const PUNI_SIZE_COMPACT: PuniSize = { deadZone: 11, maxRadius: 32 };

// 斜めとみなす角度の幅（度）。狭めにして、上下左右だけを入れたいときに斜めが入りにくくする
const DIAGONAL_DEG = 30;

const ARROWS = ["Up", "Right", "Down", "Left"] as const;

const toButtons = (dx: number, dy: number, deadZone: number): GbButton[] => {
    if (Math.hypot(dx, dy) < deadZone) return [];
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
 * 指の位置から方向を返す（ぷにコンの判定）。memo.ox / memo.oy が無ければ、いまの位置を中心にする。
 * 中心から maxRadius より離れたら、中心を指の方へ引っぱる（fixedCenter なら中心は動かさず、
 * 指の丸だけを maxRadius で止める）。見た目の CSS 変数も更新する。
 */
export const trackPuni = (
    x: number,
    y: number,
    element: HTMLElement,
    memo: Record<string, number>,
    { deadZone, maxRadius }: PuniSize,
    fixedCenter = false,
): GbButton[] => {
    if (memo.ox === undefined) {
        memo.ox = x;
        memo.oy = y;
    }
    let dx = x - memo.ox;
    let dy = y - memo.oy;
    const distance = Math.hypot(dx, dy);
    if (distance > maxRadius) {
        // 中心を指の方へ引っぱる（向きはそのまま、距離は maxRadius に保つ）
        dx = (dx / distance) * maxRadius;
        dy = (dy / distance) * maxRadius;
        if (!fixedCenter) {
            memo.ox = x - dx;
            memo.oy = y - dy;
        }
    }
    show(element, memo.ox, memo.oy, dx, dy);
    return toButtons(dx, dy, deadZone);
};

/**
 * 1 本目の指で触った所が中心になる。
 * 2 本目以降の指は無視する（ぷにコンは 1 本の指で操作するもののため）。
 * 触っている指は要素の data-puni-pointer に入れる（中心・指の丸を出す目印にもなる）。
 */
export const createPuniHitTest =
    (size: PuniSize): HitTest =>
    (x, y, _rect, element, { id, memo }) => {
        if (memo.ox === undefined) {
            if (element.dataset.puniPointer !== undefined) return [];
            element.dataset.puniPointer = String(id);
        }
        return trackPuni(x, y, element, memo, size);
    };

export const releasePuniPointer = (element: HTMLElement, pointerId: number) => {
    if (element.dataset.puniPointer === String(pointerId)) {
        delete element.dataset.puniPointer;
    }
};

/**
 * ぷにコンの見た目（いつも出ている目印と、触っている間の中心・伸び・指の丸）。
 * 親の要素に .gbc-puni を付ける。data-puni-pointer がある間だけ中心・伸び・指の丸が出る。
 */
export const PuniVisual = ({
    pressed,
}: {
    readonly pressed: ReadonlySet<GbButton>;
}) => (
    <>
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
    </>
);

const hitTest = createPuniHitTest(PUNI_SIZE);

/**
 * ぷにコン（方向の入力）。領域のどこを触っても、触った所が中心になる。
 * 指をずらした向きを 8 方向に割り当てる。指を離さずに回して方向を変えられる。
 */
export const PuniPad = (handlers: GbButtonHandlers) => {
    const ref = useRef<HTMLDivElement>(null);
    const pressed = usePointerButtons(ref, hitTest, handlers, {
        onPointerEnd: releasePuniPointer,
    });

    return (
        <div ref={ref} className="gbc-puni" aria-label="方向の操作（ぷにコン）">
            <PuniVisual pressed={pressed} />
        </div>
    );
};

export default PuniPad;
