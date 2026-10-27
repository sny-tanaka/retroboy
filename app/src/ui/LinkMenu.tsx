import type { LinkStatus } from "../link/linkSession";

/** 通信ケーブルの状態を 1 行にする（メニューと画面の知らせで使う） */
export const describeLink = (link: LinkStatus): string => {
    switch (link.phase.kind) {
        case "connecting":
            return "相手を探しています…";
        case "closed":
            switch (link.phase.reason) {
                case "local":
                    return "通信を切りました。";
                case "bye":
                    return "相手が通信を切りました。";
                case "version":
                    return "相手のアプリの版が違うので、つなげませんでした。両方を新しい版にしてください。";
                case "lost":
                    return "通信が切れました。";
            }
            break;
        case "open":
            if (link.peer.kind !== "running") {
                return "相手のゲームはまだ始まっていません。";
            }
            return link.peer.mismatch
                ? `相手のゲーム: ${link.peer.title}（${link.peer.system === "gba" ? "GBA" : "GB・GBC"}）。GBA と GB・GBC のあいだでは通信できません。`
                : `相手のゲーム: ${link.peer.title}`;
    }
    return "";
};

/** 相手を待っているときに画面に出す文言 */
export const describeWaiting = (link: LinkStatus): string =>
    link.peer.kind !== "running"
        ? "相手のゲームが始まるのを待っています…"
        : link.peer.paused
          ? "相手が一時停止しています…"
          : "相手を待っています…";

/** メニューの「通信ケーブル」。つないでいなければ「つなぐ」、つないでいれば状態と「通信を切る」 */
export const LinkMenu = ({
    link,
    onCloseLink,
    onOpenConnect,
}: {
    readonly link: LinkStatus | null;
    readonly onCloseLink: () => void;
    /** つなぐ画面（QR）を開く */
    readonly onOpenConnect: () => void;
}) =>
    !link || link.phase.kind === "closed" ? (
        <section className="gbc-menu-section">
            <h2 className="gbc-menu-heading">通信ケーブル</h2>
            {link && <p className="gbc-menu-note">{describeLink(link)}</p>}
            <button
                type="button"
                className="gbc-menu-item"
                onClick={onOpenConnect}
            >
                通信ケーブルでつなぐ
            </button>
            <p className="gbc-menu-note">
                同じ Wi-Fi のもう 1 台と、QR を読み合ってつなぎます（交換・対戦）。
            </p>
        </section>
    ) : (
        <section className="gbc-menu-section">
            <h2 className="gbc-menu-heading">通信ケーブル</h2>
            <p className="gbc-menu-note">{describeLink(link)}</p>
            {link.phase.kind === "open" && (
                <>
                    {link.rttMs !== null && (
                        <p className="gbc-menu-note">
                            往復の時間: {link.rttMs} ms
                        </p>
                    )}
                    <p className="gbc-menu-note">
                        つないでいる間は ×1 の速さに固定し、ロードはできません。相手を待つ間はゲームが止まり、音が途切れます。
                    </p>
                </>
            )}
            <button
                type="button"
                className="gbc-menu-item"
                onClick={onCloseLink}
            >
                通信を切る
            </button>
        </section>
    );

export default LinkMenu;
