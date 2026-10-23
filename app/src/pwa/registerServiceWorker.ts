// Service Worker（dist/sw.js、scripts/generate-sw.mjs が作る）を登録する。
// 本番ビルドだけで動かす（開発サーバーでキャッシュが効くと変更が見えなくなるため）。
// 新しい版の Service Worker が入ったら、画面に知らせられるようにする（onUpdateReady）。

declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;

// この画面の版（vite.config.ts がビルド時に埋め込む）。例: "2026-10-24 12:34 (abc1234)"
export const APP_VERSION = __APP_VERSION__;

let updateReady = false;
const updateListeners = new Set<() => void>();

// 新しい版が入ったかどうか（useSyncExternalStore で読む）
export const isUpdateReady = (): boolean => updateReady;

export const onUpdateReady = (listener: () => void): (() => void) => {
    updateListeners.add(listener);
    return () => updateListeners.delete(listener);
};

// 新しく受け持ちになった Service Worker のキャッシュにある version.json を読み、
// この画面のビルドの印と違えば「新しい版がある」とする。Service Worker が入れ替わっただけでは決めない
// （初めて入ったときや、開いたときにもう新しい版を読み込んでいたときにも入れ替わるため）
const checkForNewVersion = async (): Promise<void> => {
    if (updateReady) return;
    try {
        const response = await fetch(
            `${import.meta.env.BASE_URL}version.json`,
            { cache: "no-store" },
        );
        if (!response.ok) return;
        const { buildId } = (await response.json()) as { buildId?: unknown };
        if (typeof buildId !== "string" || buildId === __BUILD_ID__) return;
        updateReady = true;
        updateListeners.forEach(listener => listener());
    } catch {
        // オフラインなどで読めなければ、次に入れ替わったときにまた確かめる
    }
};

export default function registerServiceWorker(): void {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

    // sw.js は入ったらすぐ入れ替わる（skipWaiting と clients.claim）ので、入れ替わりを合図にする
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        void checkForNewVersion();
    });

    // 開いたときには確かめない。デプロイ直後は、画面はネットワークから取った新しい版なのに、
    // 受け持ちはまだ古い Service Worker（キャッシュも古い version.json）で、違って見えるため
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register(`${import.meta.env.BASE_URL}sw.js`, {
                // sw.js は HTTP キャッシュを通さずに毎回確かめる
                updateViaCache: "none",
            })
            .then((registration) => {
                // ホーム画面のアプリは閉じずに戻ってくることが多いので、前面に戻るたびに
                // 新しい版が無いか確かめる（オフラインなら失敗するだけ）
                document.addEventListener("visibilitychange", () => {
                    if (document.visibilityState === "visible") {
                        registration.update().catch(() => {});
                    }
                });
            })
            .catch((err: unknown) => {
                console.error("Service Worker の登録に失敗しました:", err);
            });
    });
}
