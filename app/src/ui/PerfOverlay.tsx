import type { PerfSnapshot } from "../emulator/perfStats";

/**
 * ゲーム画面の左上の隅に小さく出す速さ（「59.7fps / 100%」・音切れの回数・1 フレームの処理の時間）。
 * 押せない（下のゲーム画面の操作を邪魔しない）。等速の 95% を下回ると色を変える。
 */
export const PerfOverlay = ({ snapshot }: { readonly snapshot: PerfSnapshot }) => {
    const percent = Math.round(snapshot.ratio * 100);
    return (
        <div
            className="gbc-perf"
            data-slow={percent < 95 || undefined}
            aria-label="速さ"
        >
            <span>
                {snapshot.fps.toFixed(1)}fps / {percent}%
            </span>
            <span>
                音切れ {snapshot.underruns}
                {snapshot.workMsPerFrame !== null &&
                    ` · ${snapshot.workMsPerFrame.toFixed(1)}ms`}
            </span>
        </div>
    );
};

export default PerfOverlay;
