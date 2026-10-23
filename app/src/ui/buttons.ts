// コアの pressKey / releaseKey に渡すボタン名と同じ文字列（docs/upstream-notes.md）
export type GbButton =
    "Up" | "Down" | "Left" | "Right" | "A" | "B" | "Start" | "Select";

export type GbButtonHandler = (button: GbButton) => void;

export interface GbButtonHandlers {
    readonly onButtonDown: GbButtonHandler;
    readonly onButtonUp: GbButtonHandler;
}
