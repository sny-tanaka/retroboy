// Service Worker（dist/sw.js、scripts/generate-sw.mjs が作る）を登録する。
// 本番ビルドだけで動かす（開発サーバーでキャッシュが効くと変更が見えなくなるため）。
export default function registerServiceWorker(): void {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

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
