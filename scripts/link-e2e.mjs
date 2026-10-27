// 通信ケーブルの「QR でつなぐ」流れを、Playwright の WebKit（または Chromium）で端から端まで試す。
// npm run dev の /link-test.html?mode=webrtc の 2 つの iframe を 2 台の iPhone に見立て、
//   A: メニュー →「通信ケーブルでつなぐ」→「QR を出す」
//   B: 「QR を読む」→ A の QR を（偽の）カメラで読む → 自分の QR を出す
//   A: 「相手の QR を読む」→ B の QR を（偽の）カメラで読む → 両方「つながりました」
//   テスト ROM で B を子機、A を親機にして受け渡す
// と進め、各段の画面（390x844）を書き出す。カメラは偽物で、getUserMedia を「相手の画面の QR 画像を描いた canvas の
// 映像」に差し替える（QR の画像を作る → カメラの映像から jsQR で読む、までは本物）。
//
// 2 台を 1 ページに置くのは、Mac の上で別々のブラウザのプロセスどうしだと、mDNS（.local）の候補の名前が引けず
// つながらないため（同じページなら WebKit は自分で引ける）。Chromium は同じページでも .local を引けないので、
// 本当のアドレスを候補に出すフラグを付けるが、この Mac ではそれでも安定してつながらなかった（docs/link-cable-design.md 5 章）。
//
// Playwright はこのリポジトリの依存に入れていないので、別のフォルダに入れて、そこから動かす:
//   mkdir -p /tmp/linkpw && cd /tmp/linkpw && npm init -y && npm install playwright@1.64.1
//   npx playwright install webkit        # まだ入っていなければ
//   (cd <リポジトリ>/app && npm run dev)  # 別の端末で
//   node <リポジトリ>/scripts/link-e2e.mjs webkit http://localhost:5173 /tmp/linkpw/out
// 環境変数 PASTE=1 を付けると、カメラの代わりにコードの貼り付けでつなぐ。ROM=gba を付けると、GBA の通信テスト
// （games/linktest-gba/）で試す（docs/link-cable-design.md 8.5）。
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Playwright は、このファイルの場所ではなく、動かしたフォルダから読む
const { chromium, webkit } = createRequire(pathToFileURL(join(process.cwd(), "/")).href)("playwright");

const [engineName = "webkit", origin = "http://localhost:5173", outRoot = "link-e2e-out"] =
    process.argv.slice(2);
const engine = engineName === "chromium" ? chromium : webkit;
const out = join(outRoot, engineName);
mkdirSync(out, { recursive: true });
const gba = process.env.ROM === "gba";
const rom = readFileSync(
    join(
        dirname(fileURLToPath(import.meta.url)),
        gba ? "../games/linktest-gba/linktest-gba.gba" : "../testroms/link/linktest.gb",
    ),
);
// 通信用の時刻の 1 秒あたりの数（Game Boy は T サイクル、GBA は CPU のサイクル）
const cyclesPerSecond = gba ? 16777216 : 4194304;

// ページの中で動かす: getUserMedia を、__setFakeCamera で渡した画像を描いた canvas の映像に差し替える
const fakeCamera = () => {
    const images = { current: null };
    window.__setFakeCamera = dataUrl =>
        new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                images.current = img;
                resolve();
            };
            img.src = dataUrl;
        });
    MediaDevices.prototype.getUserMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const context = canvas.getContext("2d");
        const draw = () => {
            context.fillStyle = "#6b6b6b";
            context.fillRect(0, 0, 640, 480);
            if (images.current) {
                context.drawImage(images.current, 150, 70, 340, 340);
            }
            setTimeout(draw, 50);
        };
        draw();
        return canvas.captureStream(20);
    };
};

const browser = await engine.launch({
    args:
        engineName === "chromium"
            ? [
                  "--autoplay-policy=no-user-gesture-required",
                  "--disable-features=WebRtcHideLocalIpsWithMdns",
              ]
            : [],
});
const context = await browser.newContext({
    viewport: { width: 820, height: 900 },
    deviceScaleFactor: 2,
});
await context.addInitScript(fakeCamera);
const page = await context.newPage();
const errors = [];
page.on("console", m => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", e => errors.push(e.message));
// 音は出さない（?mute=1。開発サーバーは何も付けなくても無音だが、本番ビルドに向けても無音にする）
await page.goto(`${origin}/link-test.html?mode=webrtc&mute=1`);
// iPhone 15 ほどの大きさ（390x844）に並べる
await page.addStyleTag({
    content:
        "iframe { flex: none !important; width: 390px !important; height: 844px !important; }",
});
await page.waitForTimeout(1500);

const frames = { A: page.frameLocator("#left"), B: page.frameLocator("#right") };
const frameOf = name => page.frames().filter(f => f.parentFrame())[name === "A" ? 0 : 1];
const shot = (name, file) =>
    page.locator(name === "A" ? "#left" : "#right").screenshot({ path: join(out, file) });

for (const name of ["A", "B"]) {
    await frames[name]
        .locator("input[type=file]")
        .first()
        .setInputFiles({
            name: gba ? "linktest-gba.gba" : "linktest.gbc",
            mimeType: "application/octet-stream",
            buffer: rom,
        });
}
await page.waitForTimeout(1500);
for (const name of ["A", "B"]) {
    await frames[name]
        .getByText("タップして開始")
        .click({ timeout: 10000 })
        .catch(() => undefined);
}
await page.waitForTimeout(800);

const step = async (label, fn) => {
    const started = Date.now();
    await fn();
    console.log(`ok ${label} (${Date.now() - started}ms)`);
};
const openLinkSheet = async name => {
    await frames[name].getByRole("button", { name: "メニュー" }).click();
    await frames[name].getByRole("button", { name: "通信ケーブルでつなぐ" }).click();
};
const qrDataUrl = name =>
    frames[name].locator("canvas.gbc-link-qr").evaluate(c => c.toDataURL());
// 相手の QR を name のカメラに映す（PASTE=1 なら、相手のコードを貼り付ける）
const showToCamera = async name => {
    const other = name === "A" ? "B" : "A";
    if (process.env.PASTE) {
        const code = await frames[other].locator(".gbc-link-code textarea").inputValue();
        await frames[name].locator(".gbc-link-scan textarea").fill(code);
        await frames[name].getByRole("button", { name: "このコードでつなぐ" }).click();
        return;
    }
    const dataUrl = await qrDataUrl(other);
    await frameOf(name).evaluate(url => window.__setFakeCamera(url), dataUrl);
};
const pressKey = async (name, key) => {
    await frameOf(name).evaluate(k => {
        const fire = type =>
            window.dispatchEvent(
                new KeyboardEvent(type, { key: k, code: k === "x" ? "KeyX" : "KeyZ" }),
            );
        fire("keydown");
        setTimeout(() => fire("keyup"), 300);
    }, key);
    await page.waitForTimeout(600);
};

let failed = false;
try {
    await step("A: QR を出す", async () => {
        await openLinkSheet("A");
        await frames.A.getByRole("button", { name: /QR を出す/ }).click();
        await frames.A.locator("canvas.gbc-link-qr").waitFor({ timeout: 20000 });
        await shot("A", "1-a-qr.png");
    });
    await step("B: A の QR を読み、自分の QR を出す", async () => {
        await openLinkSheet("B");
        await frames.B.getByRole("button", { name: /QR を読む/ }).click();
        await showToCamera("B");
        await page.waitForTimeout(200);
        await shot("B", "2-b-scanning.png");
        await frames.B.locator("canvas.gbc-link-qr").waitFor({ timeout: 20000 });
        await shot("B", "3-b-qr.png");
    });
    await step("A: B の QR を読んで、つながる", async () => {
        await frames.A.getByRole("button", { name: "相手の QR を読む" }).click();
        await showToCamera("A");
        await frames.A.getByText("つながりました").waitFor({ timeout: 20000 });
        await frames.B.getByText("つながりました").waitFor({ timeout: 20000 });
        await shot("A", "4-a-connected.png");
        await shot("B", "4-b-connected.png");
    });
    await step("テスト ROM で受け渡す（B = 子機、A = 親機）", async () => {
        for (const name of ["A", "B"]) {
            await frames[name].getByRole("button", { name: "閉じてゲームに戻る" }).click();
        }
        await page.waitForTimeout(3500);
        await pressKey("B", "x");
        await pressKey("A", "z");
        const before = await frameOf("A").evaluate(() => window.__retroboyLink());
        await page.waitForTimeout(5000);
        const after = await frameOf("A").evaluate(() => window.__retroboyLink());
        const speed = (after.clock - before.clock) / 5 / cyclesPerSecond;
        const transfers = (after.transfers - before.transfers) / 5;
        console.log(
            `  往復 ${after.status.rttMs}ms、速さ ${speed.toFixed(3)}、1 秒に ${transfers} 回の転送、相手のゲーム ${after.status.peer.title}`,
        );
        await shot("A", "5-a-linked.png");
        await shot("B", "6-b-linked.png");
    });
} catch (err) {
    failed = true;
    console.log(`FAILED: ${err.message.split("\n")[0]}`);
    await shot("A", "fail-a.png");
    await shot("B", "fail-b.png");
}
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
console.log(`screenshots: ${out}`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
