const VERSION = "32e2209a23e74e96";
const PRECACHE = [
    "LICENSE.txt",
    "NOTICE.txt",
    "assets/LinkConnect-qFajnYn5.js",
    "assets/index-CmLjNr4H.js",
    "assets/index-DYVHNazu.css",
    "assets/mgbaCore-DHaogpMO.wasm",
    "assets/retroboyCore_bg-Ox5gkjbP.wasm",
    "builtin/gba-bench-8e113fa0cf03.gba",
    "builtin/index.json",
    "builtin/linktest-8115b9ffec26.gbc",
    "builtin/linktest-gba-e83413c47389.gba",
    "builtin/tamers-life-gba-a29b514c6f5c.gba",
    "guide/assets/index-BSc57uft.css",
    "guide/assets/index-BZAcRQlG.js",
    "guide/assets/tamers-life-DPmt5Vuz.json",
    "guide/",
    "guide/mon/001.png",
    "guide/mon/002.png",
    "guide/mon/003.png",
    "guide/mon/004.png",
    "guide/mon/005.png",
    "guide/mon/006.png",
    "guide/mon/007.png",
    "guide/mon/008.png",
    "guide/mon/009.png",
    "guide/mon/010.png",
    "guide/mon/011.png",
    "guide/mon/012.png",
    "guide/mon/013.png",
    "guide/mon/014.png",
    "guide/mon/015.png",
    "guide/mon/016.png",
    "guide/mon/017.png",
    "guide/mon/018.png",
    "guide/mon/019.png",
    "guide/mon/020.png",
    "guide/mon/021.png",
    "guide/mon/022.png",
    "guide/mon/023.png",
    "guide/mon/024.png",
    "guide/mon/025.png",
    "guide/mon/026.png",
    "guide/mon/027.png",
    "guide/mon/028.png",
    "guide/mon/029.png",
    "guide/mon/030.png",
    "guide/mon/031.png",
    "guide/mon/032.png",
    "guide/mon/033.png",
    "guide/mon/034.png",
    "guide/mon/035.png",
    "guide/mon/036.png",
    "guide/mon/037.png",
    "guide/mon/038.png",
    "guide/mon/039.png",
    "guide/mon/040.png",
    "guide/mon/041.png",
    "guide/mon/042.png",
    "guide/mon/043.png",
    "guide/mon/044.png",
    "guide/mon/045.png",
    "guide/mon/046.png",
    "guide/mon/047.png",
    "guide/mon/048.png",
    "guide/mon/049.png",
    "guide/mon/050.png",
    "guide/mon/051.png",
    "guide/mon/052.png",
    "guide/mon/053.png",
    "guide/mon/054.png",
    "guide/mon/055.png",
    "guide/mon/056.png",
    "guide/mon/057.png",
    "guide/mon/058.png",
    "guide/mon/059.png",
    "guide/mon/060.png",
    "guide/mon/061.png",
    "guide/mon/062.png",
    "guide/mon/063.png",
    "guide/mon/064.png",
    "guide/mon/065.png",
    "guide/mon/066.png",
    "guide/mon/067.png",
    "guide/mon/068.png",
    "guide/mon/069.png",
    "guide/mon/070.png",
    "guide/mon/071.png",
    "guide/mon/072.png",
    "guide/mon/073.png",
    "guide/mon/074.png",
    "guide/mon/075.png",
    "guide/mon/076.png",
    "guide/mon/077.png",
    "guide/mon/078.png",
    "guide/mon/079.png",
    "guide/mon/080.png",
    "guide/mon/081.png",
    "guide/mon/082.png",
    "guide/mon/083.png",
    "guide/mon/084.png",
    "guide/mon/085.png",
    "guide/mon/086.png",
    "guide/mon/087.png",
    "guide/mon/088.png",
    "guide/mon/089.png",
    "guide/mon/090.png",
    "guide/mon/091.png",
    "guide/mon/092.png",
    "guide/mon/093.png",
    "guide/mon/094.png",
    "guide/mon/095.png",
    "guide/mon/096.png",
    "guide/mon/097.png",
    "guide/mon/098.png",
    "guide/mon/099.png",
    "guide/mon/100.png",
    "guide/mon/101.png",
    "guide/mon/102.png",
    "guide/mon/103.png",
    "guide/mon/104.png",
    "guide/mon/105.png",
    "guide/mon/106.png",
    "guide/mon/107.png",
    "guide/mon/108.png",
    "guide/mon/109.png",
    "guide/mon/110.png",
    "guide/mon/111.png",
    "guide/mon/112.png",
    "guide/mon/113.png",
    "guide/mon/114.png",
    "guide/mon/115.png",
    "guide/mon/116.png",
    "guide/mon/117.png",
    "guide/mon/118.png",
    "guide/mon/119.png",
    "guide/mon/120.png",
    "guide/mon/121.png",
    "guide/mon/122.png",
    "guide/mon/123.png",
    "guide/mon/124.png",
    "guide/mon/125.png",
    "guide/mon/126.png",
    "guide/mon/127.png",
    "guide/mon/128.png",
    "guide/mon/129.png",
    "guide/mon/130.png",
    "guide/mon/131.png",
    "guide/mon/132.png",
    "guide/mon/133.png",
    "guide/mon/134.png",
    "guide/mon/135.png",
    "guide/mon/136.png",
    "guide/mon/137.png",
    "guide/mon/138.png",
    "guide/mon/139.png",
    "guide/mon/140.png",
    "guide/mon/141.png",
    "guide/mon/142.png",
    "guide/mon/143.png",
    "guide/mon/144.png",
    "guide/mon/145.png",
    "guide/mon/146.png",
    "guide/mon/147.png",
    "guide/mon/148.png",
    "guide/mon/149.png",
    "guide/mon/150.png",
    "guide/mon/B01.png",
    "guide/mon/B02.png",
    "guide/mon/B03.png",
    "guide/mon/B04.png",
    "guide/mon/B05.png",
    "guide/mon/B06.png",
    "guide/mon/B07.png",
    "guide/mon/B08.png",
    "guide/mon/D01.png",
    "guide/mon/D02.png",
    "guide/mon/D03.png",
    "guide/mon/D04.png",
    "guide/mon/D05.png",
    "guide/mon/D06.png",
    "guide/mon/D07.png",
    "guide/mon/D08.png",
    "guide/mon/D09.png",
    "guide/mon/D10.png",
    "guide/mon/G01.png",
    "guide/mon/G02.png",
    "guide/mon/G03.png",
    "guide/mon/G04.png",
    "guide/mon/G05.png",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/icon-maskable-512.png",
    "./",
    "licenses/agb-LICENSE.txt",
    "licenses/agbabi-LICENSE.txt",
    "licenses/arbitrary-int-LICENSE.txt",
    "licenses/bilge-LICENSE-MIT.txt",
    "licenses/blip_buf-LICENSE.txt",
    "licenses/bootix-LICENSE.txt",
    "licenses/cfg-if-LICENSE-MIT.txt",
    "licenses/cobs-LICENSE-MIT.txt",
    "licenses/compiler-builtins-LICENSE.txt",
    "licenses/compiler-rt-LICENSE.txt",
    "licenses/console_error_panic_hook-LICENSE-MIT.txt",
    "licenses/const_soft_float-LICENSE-MIT.txt",
    "licenses/crc16-LICENSE-MIT.txt",
    "licenses/critical-section-LICENSE-MIT.txt",
    "licenses/emscripten-LICENSE.txt",
    "licenses/inih-LICENSE.txt",
    "licenses/jsqr-LICENSE.txt",
    "licenses/mgba-LICENSE.txt",
    "licenses/misaki-font.txt",
    "licenses/musl-COPYRIGHT.txt",
    "licenses/num-traits-LICENSE-MIT.txt",
    "licenses/once_cell-LICENSE-MIT.txt",
    "licenses/portable-atomic-LICENSE-MIT.txt",
    "licenses/postcard-LICENSE-MIT.txt",
    "licenses/qrcode-generator-LICENSE.txt",
    "licenses/qrcodegen-no-heap-LICENSE.txt",
    "licenses/react-LICENSE.txt",
    "licenses/react-dom-LICENSE.txt",
    "licenses/retroboy-LICENSE.txt",
    "licenses/rust-std-LICENSE-MIT.txt",
    "licenses/rust-std-unicode-LICENSE.txt",
    "licenses/rustc-hash-LICENSE-MIT.txt",
    "licenses/sameboy-LICENSE.txt",
    "licenses/scheduler-LICENSE.txt",
    "licenses/serde-LICENSE-MIT.txt",
    "licenses/thiserror-LICENSE-MIT.txt",
    "licenses/typewit-LICENSE-ZLIB.txt",
    "licenses/wasm-bindgen-LICENSE-MIT.txt",
    "manifest.webmanifest",
    "version.json"
];

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
// index.html のキャッシュのキー（GitHub Pages では /retroboy/ が index.html を返す）。
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
