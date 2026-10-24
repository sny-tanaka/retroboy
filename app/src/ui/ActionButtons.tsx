import { useRef } from "react";

import type { GbButton, GbButtonHandlers } from "./buttons";
import { type HitTest, usePointerButtons } from "./usePointerButtons";

// ボタンの半径の何倍までを「押した」とみなすか。B と A の真ん中は両方の範囲に入るので、1 本指で同時押しになる
const REACH = 1.55;

/**
 * data-button を持つ子要素（丸いボタン）の中心からの距離で判定する。
 * 子要素に data-reach があれば、REACH の代わりにその倍率を使う。
 */
export const hitRoundButtons: HitTest = (x, y, rect, element) =>
    [...element.querySelectorAll<HTMLElement>("[data-button]")].flatMap(
        target => {
            const box = target.getBoundingClientRect();
            const cx = box.left - rect.left + box.width / 2;
            const cy = box.top - rect.top + box.height / 2;
            const reach =
                (box.width / 2) * Number(target.dataset.reach ?? REACH);
            return Math.hypot(x - cx, y - cy) <= reach
                ? [target.dataset.button as GbButton]
                : [];
        },
    );

/** B と A。2 本指の同時押し、1 本指で間を押す同時押し、B→A の滑らせができる。 */
export const ActionButtons = (handlers: GbButtonHandlers) => {
    const ref = useRef<HTMLDivElement>(null);
    const pressed = usePointerButtons(ref, hitRoundButtons, handlers);

    return (
        <div ref={ref} className="gbc-ab" aria-label="A ボタンと B ボタン">
            {(["B", "A"] as const).map(button => (
                <span
                    key={button}
                    data-button={button}
                    className={`gbc-round-button gbc-${button.toLowerCase()}`}
                    data-pressed={pressed.has(button) || undefined}
                >
                    {button}
                </span>
            ))}
        </div>
    );
};

export default ActionButtons;
