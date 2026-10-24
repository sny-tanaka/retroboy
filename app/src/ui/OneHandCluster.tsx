import { useRef } from "react";

import { hitRoundButtons } from "./ActionButtons";
import type { GbButtonHandlers } from "./buttons";
import {
    createPuniHitTest,
    PUNI_SIZE_COMPACT,
    PuniVisual,
    releasePuniPointer,
} from "./PuniPad";
import { type HitTest, usePointerButtons } from "./usePointerButtons";

// memo.kind の値。触り始めにどちらを操作する指かを決め、離すまで変えない
const KIND_BUTTONS = 1;
const KIND_PUNI = 2;

const puniHitTest = createPuniHitTest(PUNI_SIZE_COMPACT);

/**
 * 触り始めがボタン（A・B・START・SELECT）の押せる範囲ならボタンの指、それ以外ならぷにコンの指。
 * ボタンの指は滑らせて隣のボタンへ移れる（B→A）。ぷにコンの指は 1 本だけ（2 本目は無視）。
 */
const hitTest: HitTest = (x, y, rect, element, pointer) => {
    const { memo } = pointer;
    if (memo.kind === undefined) {
        memo.kind =
            hitRoundButtons(x, y, rect, element, pointer).length > 0
                ? KIND_BUTTONS
                : KIND_PUNI;
    }
    return memo.kind === KIND_BUTTONS
        ? hitRoundButtons(x, y, rect, element, pointer)
        : puniHitTest(x, y, rect, element, pointer);
};

/**
 * 片手 A「寄せ配置」（右手で持つ）。右下の親指の届く弧に、小さめのぷにコンと A・B・START・SELECT を置く。
 * 操作部全体が 1 つの要素で、ボタンの外を触るとそこが中心のぷにコンになる（押せない隙間が無い）。
 */
export const OneHandCluster = (handlers: GbButtonHandlers) => {
    const ref = useRef<HTMLDivElement>(null);
    const pressed = usePointerButtons(ref, hitTest, handlers, {
        onPointerEnd: releasePuniPointer,
    });

    return (
        <div
            ref={ref}
            className="gbc-puni gbc-puni-compact gbc-onehand-a"
            aria-label="片手の操作（方向・A・B・START・SELECT）"
        >
            <PuniVisual pressed={pressed} />
            <div className="gbc-onehand-a-ab">
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
            {(["Select", "Start"] as const).map(button => (
                <span
                    key={button}
                    data-button={button}
                    // 押せる範囲は見た目の丸より少し広いだけ（START と SELECT が同時に入らないように）
                    data-reach="1.15"
                    className={`gbc-onehand-pill gbc-onehand-${button.toLowerCase()}`}
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

export default OneHandCluster;
