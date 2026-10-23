interface ConfirmDialogProps {
    readonly open: boolean;
    readonly title: string;
    readonly message: string;
    readonly confirmLabel: string;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
}

/** 取り消せない操作の前に出す確認。背景を押すと「いいえ」と同じ。 */
export const ConfirmDialog = ({
    open,
    title,
    message,
    confirmLabel,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) => {
    if (!open) return null;
    return (
        <div className="gbc-dialog-backdrop" onClick={onCancel}>
            <div
                className="gbc-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="gbc-dialog-title"
                aria-describedby="gbc-dialog-message"
                onClick={event => event.stopPropagation()}
            >
                <p id="gbc-dialog-title" className="gbc-dialog-title">
                    {title}
                </p>
                <p id="gbc-dialog-message" className="gbc-dialog-message">
                    {message}
                </p>
                <div className="gbc-dialog-actions">
                    <button
                        type="button"
                        className="gbc-dialog-button"
                        onClick={onCancel}
                    >
                        いいえ
                    </button>
                    <button
                        type="button"
                        className="gbc-dialog-button gbc-dialog-confirm"
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
