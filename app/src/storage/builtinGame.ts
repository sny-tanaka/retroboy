// 内蔵ソフト（リポジトリの games/ にある自作ゲーム）の目録の 1 件。
// ビルドのときに vite の builtinGames プラグイン（plugins/builtinGames.ts）が作り、
// アプリには virtual:builtin-games として、dist には builtin/index.json として出す。
// 決まりは docs/builtin-games.md。

export type BuiltinSystem = "gb" | "gbc" | "gba";

export interface BuiltinGame {
    /** games/ の下のフォルダ名。版が上がっても変わらない */
    readonly id: string;
    /** 画面に出す名前 */
    readonly name: string;
    readonly description: string;
    /**
     * gb = 白黒のゲームボーイ用、gbc = ゲームボーイカラー対応（ヘッダの CGB フラグと合っていることをビルドで確かめる）、
     * gba = ゲームボーイアドバンス用（mGBA で動かす。ヘッダが GBA の形であることをビルドで確かめる）
     */
    readonly system: BuiltinSystem;
    /** ROM の中身の SHA-256（16 進）。ROM の ID と同じで、ゲーム内セーブ・セーブステートはこれで分かれる */
    readonly sha256: string;
    /** ROM の大きさ（バイト） */
    readonly size: number;
    /** dist の中での ROM のパス（例: builtin/linktest-0123456789ab.gb）。中身が変わると名前も変わる */
    readonly file: string;
    /** ゲーム内セーブの形式の番号。版が上がっても同じなら、前の版のゲーム内セーブを引き継ぐ */
    readonly saveFormat: number;
}
