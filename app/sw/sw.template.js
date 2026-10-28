// Service Worker の本体。ビルド後に scripts/generate-sw.mjs が先頭に
//   const VERSION = "<dist の中身のハッシュ>";
//   const PRECACHE = ["./", "assets/index-xxxx.js", ...];
// を付けて dist/sw.js に書き出す（このファイルは直接は配信しない）。
//
// - アプリ本体（HTML・JS・CSS・WASM・アイコン・manifest）と内蔵ソフト（builtin/ の自作ゲームの ROM と目録）
//   だけをキャッシュする。利用者が追加した ROM・ゲーム内セーブ・セーブステートは
//   IndexedDB / localStorage / ファイルで扱い、URL で取りに行かないのでここを通らない。
// - 同じオリジンの GET 以外（外部の URL、blob:、data: など）には手を出さない。
//   このファイルから外へ通信することはない。
// - 新しい版を配ると VERSION が変わり、sw.js が別物になる → 新しい Service Worker が
//   入って新しいキャッシュを作り、古い版のキャッシュは activate で消す。

/* global VERSION, PRECACHE */

const CACHE_PREFIX = "retroboy-snap-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
// index.html のキャッシュのキー（GitHub Pages では /retroboy-snap/ が index.html を返す）。
// 置き場所（スコープ）からの相対で決めるので、サブパスでも / でも同じように動く
const SHELL_URL = new URL("./", self.registration.scope).href;
// ページを開くとき、これより遅ければネットワークをあきらめてキャッシュから出す
const NAVIGATION_TIMEOUT_MS = 3000;

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE_NAME);
            // HTTP キャッシュを通さずに取る（古い index.html を拾わないため）
            await cache.addAll(
                PRECACHE.map(
                    (path) =>
                        new Request(new URL(path, self.registration.scope), {
                            cache: "reload",
                        }),
                ),
            );
            // 待たずに入れ替わる。開いている画面は古い JS のまま動き続け、
            // 次に開いたときから新しい版になる（このアプリは起動時に全部読み込むので、
            // 途中で古い版のファイルを取りに行くことはない）
            await self.skipWaiting();
        })(),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(
                names
                    .filter(
                        (name) =>
                            name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME,
                    )
                    .map((name) => caches.delete(name)),
            );
            await self.clients.claim();
        })(),
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    // 外部の URL・blob:・data: などはブラウザに任せる（キャッシュしない）
    if (url.origin !== self.location.origin) return;

    if (request.mode === "navigate") {
        event.respondWith(handleNavigation(request));
        return;
    }
    event.respondWith(handleAsset(request));
});

// ページ（index.html）: オンラインなら新しい版を、オフラインや遅いときはキャッシュを出す。
// cache: "no-cache": HTTP キャッシュにあっても必ずサーバーに確かめる（ETag で、変わっていなければ 304）。
// GitHub Pages は index.html にも Cache-Control: max-age=600 を付け、ヘッダーを変えられない。
// そのままだとデプロイ後 10 分ほど古い index.html が出て、もう配信していない古い JS を取りに行くことがある
async function handleNavigation(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        return await withTimeout(
            fetch(request, { cache: "no-cache" }),
            NAVIGATION_TIMEOUT_MS,
        );
    } catch {
        // そのページのキャッシュ（攻略サイトの guide/ など）。無ければアプリの index.html
        const cached =
            (await cache.match(request.url.split("#")[0], { ignoreVary: true, ignoreSearch: true })) ??
            (await cache.match(SHELL_URL, { ignoreVary: true }));
        if (cached) return cached;
        return fetch(request);
    }
}

// JS・CSS・WASM・アイコン・内蔵ソフトの ROM: キャッシュにあればそれを出し、無ければネットワークから取る
// （取ったものはキャッシュに足さない。キャッシュに入るのは PRECACHE の一覧だけ）
// ignoreVary: サーバーが Vary: Origin を返すと、Origin 付きで取りに来る
// <script type="module"> がキャッシュ（Origin なしで取った）と一致せず、オフラインで失敗するため
async function handleAsset(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    return fetch(request);
}

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), ms);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            },
        );
    });
}
