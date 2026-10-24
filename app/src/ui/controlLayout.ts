import { useState } from "react";

/**
 * 操作部の配置。twohand は本家のような両手の配置。
 * onehand-a / onehand-b は片手（右手）用（寄せ配置・ジェスチャー）。
 */
export type ControlLayout = "twohand" | "onehand-a" | "onehand-b";

export const CONTROL_LAYOUTS: readonly {
    readonly value: ControlLayout;
    readonly label: string;
    readonly description: string;
}[] = [
    {
        value: "twohand",
        label: "両手",
        description: "左にぷにコン、右に A・B",
    },
    {
        value: "onehand-a",
        label: "片手 A（寄せ配置）",
        description:
            "右下に小さめのぷにコンと A・B・START・SELECT。ボタンの外を触るとぷにコン",
    },
    {
        value: "onehand-b",
        label: "片手 B（ジェスチャー）",
        description:
            "なぞる＝方向、タップ＝A、長押しかもう 1 本の指＝B。START・SELECT は右下",
    },
];

export const DEFAULT_CONTROL_LAYOUT: ControlLayout = "twohand";

// localStorage のキー
const STORAGE_KEY = "controlLayout";

export const parseControlLayout = (
    value: string | null,
): ControlLayout | undefined =>
    CONTROL_LAYOUTS.find(layout => layout.value === value)?.value;

const readStored = (): ControlLayout => {
    try {
        return (
            parseControlLayout(localStorage.getItem(STORAGE_KEY)) ??
            DEFAULT_CONTROL_LAYOUT
        );
    } catch {
        // localStorage を使えない環境（プライベートブラウズの一部など）では既定にする
        return DEFAULT_CONTROL_LAYOUT;
    }
};

/** 選んだ操作の配置。localStorage に覚えて、次の起動でも使う */
export const useControlLayout = (
    initial?: ControlLayout,
): [ControlLayout, (layout: ControlLayout) => void] => {
    const [layout, setLayout] = useState<ControlLayout>(
        () => initial ?? readStored(),
    );
    const select = (next: ControlLayout): void => {
        setLayout(next);
        try {
            localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // 覚えられなくても、この起動の間は選んだ配置で使える
        }
    };
    return [layout, select];
};
