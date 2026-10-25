import type { LinkStatus } from "../link/linkSession";
import type { RomSummary } from "../storage/romDb";
import type { StorageStatus } from "../storage/storageStatus";
import type { ControlLayout } from "./controlLayout";
import { ControlLayoutMenu } from "./ControlLayoutMenu";
import { LinkMenu } from "./LinkMenu";

interface RomMenuProps {
    readonly roms: readonly RomSummary[];
    /** いま読み込んでいる ROM（遊んでいる・開始待ち） */
    readonly currentRomId: string | null;
    /** 読み込み中などで ROM を選べない */
    readonly busy: boolean;
    /** ゲームが動いていて、セーブステートを使える */
    readonly gameActive: boolean;
    readonly storageStatus: StorageStatus | null;
    /** このアプリの版（ビルドした日時とコミット）。メニューの一番下に出す */
    readonly appVersion: string;
    /** 新しい版が届いていて、読み込み直せば切り替わる */
    readonly updateReady: boolean;
    readonly onReloadToUpdate: () => void;
    readonly onSelectRom: (id: string) => void;
    readonly onAddRom: () => void;
    readonly onExportState: () => void;
    readonly onImportState: () => void;
    /** 操作の配置（両手・片手 A・片手 B） */
    readonly controlLayout: ControlLayout;
    readonly onSelectControlLayout: (layout: ControlLayout) => void;
    /** 自分で一時停止している（メニューを開いたことによる一時停止は含めない） */
    readonly paused: boolean;
    readonly onTogglePause: () => void;
    /** 通信ケーブルのつながり。無ければ「通信ケーブル」の欄を出さない */
    readonly link: LinkStatus | null;
    readonly onCloseLink: () => void;
}

/** メニューの一番上の「一時停止」「再開」。押すとメニューは閉じる（呼ぶ側で閉じる） */
export const PauseMenu = ({
    paused,
    disabled,
    onTogglePause,
}: {
    readonly paused: boolean;
    readonly disabled: boolean;
    readonly onTogglePause: () => void;
}) => (
    <section className="gbc-menu-section">
        <h2 className="gbc-menu-heading">ゲーム</h2>
        <button
            type="button"
            className="gbc-menu-item"
            disabled={disabled}
            onClick={onTogglePause}
        >
            {paused ? "▶ 再開" : "Ⅱ 一時停止"}
        </button>
    </section>
);

const formatStorage = ({ persisted, usageMB, quotaMB }: StorageStatus) => ({
    persisted:
        persisted === null
            ? "この環境では使えません"
            : persisted
              ? "許可されています（ブラウザが勝手に消さない）"
              : "許可されていません（容量が足りないと消されることがあります）",
    usage: `${usageMB ?? "?"} MB / ${quotaMB ?? "?"} MB`,
});

/** メニューの中身: 一時停止、ROM の一覧と追加、操作の配置、セーブステートのファイル、保存の状態、アプリの版 */
export const RomMenu = ({
    roms,
    currentRomId,
    busy,
    gameActive,
    storageStatus,
    appVersion,
    updateReady,
    onReloadToUpdate,
    onSelectRom,
    onAddRom,
    onExportState,
    onImportState,
    controlLayout,
    onSelectControlLayout,
    paused,
    onTogglePause,
    link,
    onCloseLink,
}: RomMenuProps) => {
    const linked = link?.phase.kind === "open";
    const storage = storageStatus && formatStorage(storageStatus);
    return (
        <>
            <PauseMenu
                paused={paused}
                disabled={!gameActive}
                onTogglePause={onTogglePause}
            />
            {link && <LinkMenu link={link} onCloseLink={onCloseLink} />}
            <section className="gbc-menu-section">
                <h2 className="gbc-menu-heading">ROM</h2>
                {roms.length === 0 ? (
                    <p className="gbc-menu-note">まだ登録されていません。</p>
                ) : (
                    <ul className="gbc-menu-list">
                        {roms.map(rom => {
                            const current = rom.id === currentRomId;
                            return (
                                <li key={rom.id}>
                                    <button
                                        type="button"
                                        className="gbc-menu-item"
                                        data-current={current || undefined}
                                        aria-current={current || undefined}
                                        disabled={busy}
                                        onClick={() => onSelectRom(rom.id)}
                                    >
                                        <span className="gbc-menu-item-name">
                                            {rom.name}
                                        </span>
                                        {current && (
                                            <span className="gbc-menu-badge">
                                                選択中
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                <button
                    type="button"
                    className="gbc-menu-item gbc-menu-add"
                    disabled={busy}
                    onClick={onAddRom}
                >
                    ＋ ROM を追加
                </button>
            </section>

            <ControlLayoutMenu
                value={controlLayout}
                onChange={onSelectControlLayout}
            />

            <section className="gbc-menu-section">
                <h2 className="gbc-menu-heading">セーブステート（ファイル）</h2>
                <div className="gbc-menu-row">
                    <button
                        type="button"
                        className="gbc-menu-item"
                        disabled={!gameActive}
                        onClick={onExportState}
                    >
                        ファイルに書き出す
                    </button>
                    <button
                        type="button"
                        className="gbc-menu-item"
                        disabled={!gameActive || linked}
                        onClick={onImportState}
                    >
                        ファイルから読み込む
                    </button>
                </div>
                <p className="gbc-menu-note">
                    読み込むと、いまの進みは上書きされます。画面の「セーブ」「ロード」が使う端末内のセーブとは別です。ゲームを始めてから使えます。通信ケーブルでつないでいる間は読み込めません。
                </p>
            </section>

            <section className="gbc-menu-section">
                <h2 className="gbc-menu-heading">保存の状態</h2>
                {storage ? (
                    <dl className="gbc-menu-facts">
                        <dt>永続化</dt>
                        <dd>{storage.persisted}</dd>
                        <dt>使用量</dt>
                        <dd>{storage.usage}</dd>
                    </dl>
                ) : (
                    <p className="gbc-menu-note">確認中…</p>
                )}
                <p className="gbc-menu-note">
                    キーボード: 方向 = 矢印キー / A = Z / B = X / START = Enter
                    / SELECT = Space
                </p>
            </section>

            <section className="gbc-menu-section">
                <h2 className="gbc-menu-heading">このアプリ</h2>
                {updateReady && (
                    <>
                        <button
                            type="button"
                            className="gbc-menu-item gbc-menu-add"
                            onClick={onReloadToUpdate}
                        >
                            新しい版に切り替える（再読み込み）
                        </button>
                        <p className="gbc-menu-note">
                            ゲーム内セーブを書き出してから読み込み直します。セーブしていない進みは失われます。
                        </p>
                    </>
                )}
                <p className="gbc-menu-note gbc-menu-version">
                    バージョン: {appVersion}
                </p>
            </section>
        </>
    );
};

export default RomMenu;
