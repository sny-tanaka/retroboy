import { useRef } from "react";

import type { GbButton, GbButtonHandlers } from "./buttons";
import { type HitTest, usePointerButtons } from "./usePointerButtons";

// ボタンの全体を押せる範囲にする（見た目の外側の余白も含む。.gbc-shoulder の padding）
const hitWhole =
    (button: GbButton): HitTest =>
    () => [button];

const Shoulder = ({
    button,
    handlers,
}: {
    readonly button: "L" | "R";
    readonly handlers: GbButtonHandlers;
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const pressed = usePointerButtons(ref, hitWhole(button), handlers);
    return (
        <div
            ref={ref}
            className={`gbc-shoulder gbc-shoulder-${button.toLowerCase()}`}
            aria-label={`${button} ボタン`}
        >
            <span
                className="gbc-shoulder-key"
                data-pressed={pressed.has(button) || undefined}
            >
                {button}
            </span>
        </div>
    );
};

/**
 * GBA の L・R。操作部の上の左右の角（画面のすぐ下の肩）に置く。両手で持ったときに、
 * ぷにコンと A・B に置いた親指を少し上へ伸ばして届く所。GBA のゲームのときだけ出す。
 */
export const ShoulderButtons = (handlers: GbButtonHandlers) => (
    <>
        <Shoulder button="L" handlers={handlers} />
        <Shoulder button="R" handlers={handlers} />
    </>
);

export default ShoulderButtons;
