import "./gbc.css";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { useDialogFocus } from "./useDialogFocus";

interface ConfirmDialogProps {
    readonly open: boolean;
    readonly title: string;
    readonly message: string;
    readonly confirmLabel: string;
    /** 文言の上に出すもの（ロードの確認の、セーブしたときの画面など） */
    readonly figure?: ReactNode;
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
    figure,
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
                {figure}
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

/** Blob を img に出せる data URL にする（読み終わるまでと、読めなかったときは undefined） */
const useDataUrl = (blob: Blob | undefined): string | undefined => {
    const [loaded, setLoaded] = useState<{
        readonly blob: Blob;
        readonly url: string;
    }>();
    useEffect(() => {
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                setLoaded({ blob, url: reader.result });
            }
        };
        reader.readAsDataURL(blob);
        return () => reader.abort();
    }, [blob]);
    return blob && loaded?.blob === blob ? loaded.url : undefined;
};

/** 端末内のセーブ（ロードの確認に出す分） */
export interface SavedSlotInfo {
    readonly savedAt: number;
    /** セーブしたときのゲーム画面（PNG）。古いセーブには無い */
    readonly screenshot?: Blob;
}

/** セーブステートを読み込む前の確認（上の「ロード」とメニューの「ファイルから読み込む」で共通） */
export const LoadStateConfirm = ({
    slot,
    ...props
}: Pick<ConfirmDialogProps, "open" | "onConfirm" | "onCancel"> & {
    /** 端末内のセーブから戻すときの、そのセーブ。無ければファイルから読み込む */
    readonly slot?: SavedSlotInfo;
}) => {
    const screenshotUrl = useDataUrl(props.open ? slot?.screenshot : undefined);
    return (
        <ConfirmDialog
            title="ロードしますか？"
            message={
                slot === undefined
                    ? "いまの進みは、選んだセーブステートの状態で上書きされます。"
                    : `いまの進みは、${formatSavedAt(slot.savedAt)} にセーブした状態で上書きされます。`
            }
            figure={
                screenshotUrl && (
                    <img
                        className="gbc-dialog-screenshot"
                        src={screenshotUrl}
                        width={160}
                        height={144}
                        alt="セーブしたときのゲーム画面"
                    />
                )
            }
            confirmLabel="ロードする"
            {...props}
        />
    );
};

const formatSavedAt = (time: number): string =>
    new Date(time).toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

export default ConfirmDialog;
