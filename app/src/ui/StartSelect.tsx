import { useRef } from "react";

import type { GbButton, GbButtonHandlers } from "./buttons";
import { type HitTest, usePointerButtons } from "./usePointerButtons";

// 細いボタンなので、左右半分ずつをそれぞれの押せる範囲にする（見た目より広い）
const hitTest: HitTest = (x, _y, rect): GbButton[] => [
    x < rect.width / 2 ? "Select" : "Start",
];

/** 水平に並んだ SELECT と START。 */
export const StartSelect = (handlers: GbButtonHandlers) => {
    const ref = useRef<HTMLDivElement>(null);
    const pressed = usePointerButtons(ref, hitTest, handlers);

    return (
        <div ref={ref} className="gbc-start-select">
            {(["Select", "Start"] as const).map(button => (
                <span key={button} className="gbc-pill-slot">
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

export default StartSelect;
