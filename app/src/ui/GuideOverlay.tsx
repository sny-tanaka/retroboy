import { useRef } from "react";

import { useDialogFocus } from "./useDialogFocus";

interface GuideOverlayProps {
    /** 出している（false のときも、一度開いたら iframe は残して隠すだけ） */
    readonly open: boolean;
    /** 攻略サイトの場所（dist の中の相対パス。例: guide/）。一度も開いていなければ null */
    readonly src: string | null;
    readonly onClose: () => void;
}

/**
 * 内蔵ソフトの攻略サイトを、画面いっぱいの重ね窓（iframe）で出す。メニューの「攻略」から開き、「とじる」でメニューに戻る。
 * 新しいタブにしないのは、iPhone のホーム画面のアプリだとタブで開くとアプリの外（Safari）に移ってしまうため。
 * とじても iframe は消さずに隠すので、見ていたページとスクロールの位置は次に開いたときも残る。
 */
export const GuideOverlay = ({ open, src, onClose }: GuideOverlayProps) => {
    const ref = useRef<HTMLDivElement>(null);
    useDialogFocus(open, ref, onClose);
    if (src === null) return null;
    return (
        <div
            ref={ref}
            className="gbc-guide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="gbc-guide-title"
            tabIndex={-1}
            hidden={!open}
        >
            <div className="gbc-guide-header">
                <span id="gbc-guide-title">攻略</span>
                <button type="button" className="gbc-sheet-close" data-autofocus onClick={onClose}>
                    とじる
                </button>
            </div>
            <iframe className="gbc-guide-frame" src={src} title="攻略" />
        </div>
    );
};
