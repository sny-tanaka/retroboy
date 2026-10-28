import { useState } from "react";

import {
    GBA_LEAD_CHOICES,
    type GbaLeadFrames,
    getGbaLeadFrames,
    setGbaLeadFrames,
} from "../gba/gbaLead";
import type { LinkStatus } from "../link/linkSession";
import type { BuiltinGame } from "../storage/builtinGame";
import type { RomSummary } from "../storage/romDb";
import type { RomSystem } from "../storage/romSystem";
import type { StorageStatus } from "../storage/storageStatus";
import type { ControlLayout } from "./controlLayout";
import { ControlLayoutMenu } from "./ControlLayoutMenu";
import { LinkMenu } from "./LinkMenu";

interface RomMenuProps {
    /** 利用者が追加した ROM */
    readonly roms: readonly RomSummary[];
    /** アプリに入っている自作ゲーム。選ぶだけで遊べて、削除はできない */
    readonly builtinGames: readonly BuiltinGame[];
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
    readonly onOpenLinkConnect: () => void;
    /** いま読み込んでいる ROM の本体（無ければ null） */
    readonly system: RomSystem | null;
    /** 速さの表示（画面の隅の fps）を出しているか。本体ごとに覚える */
    readonly perfShown: boolean;
    readonly onTogglePerf: () => void;
    /** いま遊んでいる内蔵ソフトに攻略サイトがあれば、それを重ね窓で開く。無ければ null（「攻略」を出さない） */
    readonly onOpenGuide: (() => void) | null;
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

/** 「速さの表示」の中の、GBA の音の先読みの長さ（gba/gbaLead.ts）。メニューを閉じて再開したときから効く */
const GbaLeadMenu = () => {
    const [lead, setLead] = useState<GbaLeadFrames>(getGbaLeadFrames);
    return (
        <>
            <div
                className="gbc-menu-row"
                role="radiogroup"
                aria-label="GBA の音の先読み"
            >
                {GBA_LEAD_CHOICES.map(frames => (
                    <button
                        key={frames}
                        type="button"
                        role="radio"
                        aria-checked={frames === lead}
                        className="gbc-menu-item"
                        data-current={frames === lead || undefined}
                        onClick={() => {
                            setGbaLeadFrames(frames);
                            setLead(frames);
                        }}
                    >
                        {Math.round((frames * 1000) / 59.7275)}ms
                    </button>
                ))}
            </div>
            <p className="gbc-menu-note">
                GBA の音の先読み（いまは {lead} フレーム）。長いほど音が途切れにくく、短いほどボタンの反応が速い。メニューを閉じたときから効きます。
            </p>
        </>
    );
};

const SYSTEM_LABELS = { gb: "GB", gbc: "GBC", gba: "GBA" } as const;

/** メニューの「内蔵ソフト」。アプリに入っている自作ゲームを選ぶ */
const BuiltinGameMenu = ({
    games,
    currentRomId,
    busy,
    onSelectRom,
}: {
    readonly games: readonly BuiltinGame[];
    readonly currentRomId: string | null;
    readonly busy: boolean;
    readonly onSelectRom: (id: string) => void;
}) => {
    if (games.length === 0) return null;
    return (
        <section className="gbc-menu-section">
            <h2 className="gbc-menu-heading">内蔵ソフト</h2>
            <ul className="gbc-menu-list">
                {games.map(game => {
                    const current = game.sha256 === currentRomId;
                    return (
                        <li key={game.id}>
                            <button
                                type="button"
                                className="gbc-menu-item gbc-menu-choice"
                                data-current={current || undefined}
                                aria-current={current || undefined}
                                disabled={busy}
                                onClick={() => onSelectRom(game.sha256)}
                            >
                                <span className="gbc-menu-choice-text">
                                    <span className="gbc-menu-item-name">
                                        {game.name}
                                    </span>
                                    <span className="gbc-menu-choice-description">
                                        {game.description}
                                    </span>
                                </span>
                                <span className="gbc-menu-system">
                                    {SYSTEM_LABELS[game.system]}
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
            <p className="gbc-menu-note">
                このアプリに入っている自作のソフトです。ファイルを用意しなくても遊べ、オフラインでも選べます。
            </p>
        </section>
    );
};

/** メニューの中身: 一時停止、内蔵ソフト、ROM の一覧と追加、操作の配置、セーブステートのファイル、保存の状態、アプリの版 */
export const RomMenu = ({
    roms,
    builtinGames,
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
    onOpenLinkConnect,
    system,
    perfShown,
    onTogglePerf,
    onOpenGuide,
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
            {onOpenGuide && (
                <section className="gbc-menu-section">
                    <h2 className="gbc-menu-heading">攻略</h2>
                    <button type="button" className="gbc-menu-item" onClick={onOpenGuide}>
                        攻略を見る（図鑑・技と職業・配合と相性）
                    </button>
                    <p className="gbc-menu-note">
                        ゲームは止めたまま、画面いっぱいに開きます。「とじる」でこのメニューに戻ります。
                    </p>
                </section>
            )}
            <LinkMenu
                link={link}
                onCloseLink={onCloseLink}
                onOpenConnect={onOpenLinkConnect}
            />
            <BuiltinGameMenu
                games={builtinGames}
                currentRomId={currentRomId}
                busy={busy}
                onSelectRom={onSelectRom}
            />
            <section className="gbc-menu-section">
                <h2 className="gbc-menu-heading">追加した ROM</h2>
                {roms.length === 0 ? (
                    <p className="gbc-menu-note">まだ追加していません。</p>
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
                <h2 className="gbc-menu-heading">速さの表示</h2>
                <button
                    type="button"
                    role="switch"
                    aria-checked={perfShown}
                    className="gbc-menu-item gbc-menu-choice"
                    data-current={perfShown || undefined}
                    disabled={system === null}
                    onClick={onTogglePerf}
                >
                    <span className="gbc-menu-choice-text">
                        <span className="gbc-menu-item-name">
                            画面の隅に fps を出す
                            {system && `（${system === "gba" ? "GBA" : "GB・GBC"}）`}
                        </span>
                        <span className="gbc-menu-choice-description">
                            1 秒あたりのフレーム・等速に対する割合・音切れの回数・1 フレームの処理の時間
                        </span>
                    </span>
                    {perfShown && <span className="gbc-menu-badge">表示中</span>}
                </button>
                <p className="gbc-menu-note">
                    GBA と GB・GBC で別々に覚えます（GBA は初めから出します）。
                </p>
                {system === "gba" && <GbaLeadMenu />}
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
                    / SELECT = Space / L = A / R = S（L・R は GBA だけ）
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
