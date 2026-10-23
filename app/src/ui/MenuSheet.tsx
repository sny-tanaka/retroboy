import type { ReactNode } from "react";

interface MenuSheetProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly children?: ReactNode;
}

/** 下から出るメニュー。中身（ROM の選択・切り替えなど）は children で渡す。 */
export const MenuSheet = ({ open, onClose, children }: MenuSheetProps) => {
    if (!open) return null;
    return (
        <div className="gbc-sheet-backdrop" onClick={onClose}>
            <div
                className="gbc-sheet"
                role="dialog"
                aria-label="メニュー"
                onClick={event => event.stopPropagation()}
            >
                <div className="gbc-sheet-header">
                    <span>メニュー</span>
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
