import { type RefObject, useEffect, useRef } from "react";

/**
 * 開いている間: 開いたときに中へフォーカスを移し、Esc で onClose を呼ぶ。
 * 閉じたら、開く前にフォーカスがあった所へ戻す。
 * 後ろの本体を Tab で触れないようにするのは、呼ぶ側で本体に inert を付けて行う。
 */
export const useDialogFocus = (
    open: boolean,
    ref: RefObject<HTMLElement | null>,
    onClose: () => void,
): void => {
    const latest = useRef(onClose);
    useEffect(() => {
        latest.current = onClose;
    });

    useEffect(() => {
        if (!open) return;
        const before = document.activeElement;
        const element = ref.current;
        (
            element?.querySelector<HTMLElement>("[data-autofocus]") ?? element
        )?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                latest.current();
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            if (before instanceof HTMLElement && before.isConnected) {
                before.focus();
            }
        };
    }, [open]);
};
