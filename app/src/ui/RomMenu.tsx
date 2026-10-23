import type { RomSummary } from "../storage/romDb";
import type { StorageStatus } from "../storage/storageStatus";

interface RomMenuProps {
    readonly roms: readonly RomSummary[];
    /** いま読み込んでいる ROM（遊んでいる・開始待ち） */
    readonly currentRomId: string | null;
    /** 読み込み中などで ROM を選べない */
    readonly busy: boolean;
    /** ゲームが動いていて、セーブステートを使える */
    readonly gameActive: boolean;
    readonly storageStatus: StorageStatus | null;
    readonly onSelectRom: (id: string) => void;
    readonly onAddRom: () => void;
    readonly onExportState: () => void;
    readonly onImportState: () => void;
}

const formatStorage = ({ persisted, usageMB, quotaMB }: StorageStatus) => ({
    persisted:
        persisted === null
            ? "この環境では使えません"
            : persisted
              ? "許可されています（ブラウザが勝手に消さない）"
              : "許可されていません（容量が足りないと消されることがあります）",
    usage: `${usageMB ?? "?"} MB / ${quotaMB ?? "?"} MB`,
});

/** メニューの中身: ROM の一覧と追加、セーブステートのファイル、保存の状態 */
export const RomMenu = ({
    roms,
    currentRomId,
    busy,
    gameActive,
    storageStatus,
    onSelectRom,
    onAddRom,
    onExportState,
    onImportState,
}: RomMenuProps) => {
    const storage = storageStatus && formatStorage(storageStatus);
    return (
        <>
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
                        disabled={!gameActive}
                        onClick={onImportState}
                    >
                        ファイルから読み込む
                    </button>
                </div>
                <p className="gbc-menu-note">
                    読み込むと、いまの進みは上書きされます。ゲームを始めてから使えます。
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
        </>
    );
};

export default RomMenu;
