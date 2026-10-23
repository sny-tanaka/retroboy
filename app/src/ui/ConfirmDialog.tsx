import "./gbc.css";

import { useRef } from "react";

import { useDialogFocus } from "./useDialogFocus";

interface ConfirmDialogProps {
    readonly open: boolean;
    readonly title: string;
    readonly message: string;
    readonly confirmLabel: string;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
}

/**
 * 取り消せない操作の前に出す確認。背景を押す・Esc は「いいえ」と同じ。
 * 開いたら「いいえ」にフォーカスを移す（Enter で誤って実行しないように）。
 */
export const ConfirmDialog = ({
    open,
    title,
    message,
    confirmLabel,
    onConfirm,
    onCancel,
}: ConfirmDialogProps) => {
    const ref = useRef<HTMLDivElement>(null);
    useDialogFocus(open, ref, onCancel);

    if (!open) return null;
    return (
        <div className="gbc-dialog-backdrop" onClick={onCancel}>
            <div
                ref={ref}
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
                        data-autofocus
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

/** セーブステートを読み込む前の確認（上の「ロード」とメニューの「ファイルから読み込む」で共通） */
export const LoadStateConfirm = ({
    savedAt,
    ...props
}: Pick<ConfirmDialogProps, "open" | "onConfirm" | "onCancel"> & {
    /** 端末内のセーブから戻すときの、そのセーブの日時。無ければファイルから読み込む */
    readonly savedAt?: number;
}) => (
    <ConfirmDialog
        title="ロードしますか？"
        message={
            savedAt === undefined
                ? "いまの進みは、選んだセーブステートの状態で上書きされます。"
                : `いまの進みは、${formatSavedAt(savedAt)} にセーブした状態で上書きされます。`
        }
        confirmLabel="ロードする"
        {...props}
    />
);

const formatSavedAt = (time: number): string =>
    new Date(time).toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

export default ConfirmDialog;
