import { type ReactNode, useRef } from "react";

import { useDialogFocus } from "./useDialogFocus";

interface MenuSheetProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly children?: ReactNode;
    /** 上に出す名前。既定は「メニュー」 */
    readonly title?: string;
}

/**
 * 下から出るメニュー。中身（ROM の選択・切り替えなど）は children で渡す。
 * 開いたらメニューにフォーカスを移し、Esc で閉じる。開いている間は呼ぶ側で本体を inert にする。
 */
export const MenuSheet = ({
    open,
    onClose,
    children,
    title = "メニュー",
}: MenuSheetProps) => {
    const ref = useRef<HTMLDivElement>(null);
    useDialogFocus(open, ref, onClose);

    if (!open) return null;
    return (
        <div className="gbc-sheet-backdrop" onClick={onClose}>
            <div
                ref={ref}
                className="gbc-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="gbc-sheet-title"
                tabIndex={-1}
                onClick={event => event.stopPropagation()}
            >
                <div className="gbc-sheet-header">
                    <span id="gbc-sheet-title">{title}</span>
                    <button
                        type="button"
                        className="gbc-sheet-close"
                        onClick={onClose}
                    >
                        閉じる
                    </button>
                </div>
                <div className="gbc-sheet-body">{children}</div>
            </div>
        </div>
    );
};

export default MenuSheet;
