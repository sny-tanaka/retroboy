// QR を作る（qrcode-generator、MIT）・カメラの映像から読む（jsQR、Apache-2.0）。
// iOS の Safari には BarcodeDetector が無いので、映像を canvas に描いて jsQR で読む。
// この 2 つは「通信ケーブル」の画面を開いたときだけ読み込む（ui/LinkConnectSheet.tsx を遅れて読み込む）。
import jsQR from "jsqr";
import qrcode from "qrcode-generator";

/**
 * text の QR の黒いところ（[行][列]）。誤り訂正は L（画面に出して読むので汚れに強くなくてよく、小さくしたい）。
 * 英数字モードに入る文字だけなら英数字モードにする（通信ケーブルのコードはそうしてある。link/signal.ts）
 */
export const qrModules = (text: string): boolean[][] => {
    const code = qrcode(0, "L");
    code.addData(text, /^[0-9A-Z $%*+\-./:]*$/.test(text) ? "Alphanumeric" : "Byte");
    code.make();
    const size = code.getModuleCount();
    return Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, col) => code.isDark(row, col)),
    );
};

/** QR を canvas に描く。1 マスを cell px にし、まわりに 4 マスの白い余白を付ける */
export const drawQr = (
    canvas: HTMLCanvasElement,
    text: string,
    cell: number,
): void => {
    const modules = qrModules(text);
    const quiet = 4;
    const size = (modules.length + quiet * 2) * cell;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "#000";
    modules.forEach((row, y) =>
        row.forEach((dark, x) => {
            if (dark) {
                context.fillRect((x + quiet) * cell, (y + quiet) * cell, cell, cell);
            }
        }),
    );
};

export class CameraError extends Error {}

/** 背面のカメラを開く。許可されない・カメラが無いときは CameraError（文言はそのまま画面に出す） */
export const openCamera = async (): Promise<MediaStream> => {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new CameraError(
            "この環境ではカメラを使えません。コードの貼り付けを使ってください。",
        );
    }
    try {
        return await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false,
        });
    } catch (err) {
        const denied =
            err instanceof DOMException &&
            (err.name === "NotAllowedError" || err.name === "SecurityError");
        throw new CameraError(
            denied
                ? "カメラが使えません。「設定 > アプリ > Safari > カメラ」で許可するか、コードの貼り付けを使ってください。"
                : "カメラを開けませんでした。コードの貼り付けを使ってください。",
        );
    }
};

export const stopCamera = (stream: MediaStream | null): void =>
    stream?.getTracks().forEach(track => track.stop());

// 読むときの画像の長い辺（px）。大きいほど小さな QR も読めるが重い
const SCAN_SIZE = 720;

/**
 * video に映っている QR を読み続け、読めた文字列を onText に渡す。onText が true を返したら止める。
 * 戻り値を呼ぶと止める
 */
export const scanQr = (
    video: HTMLVideoElement,
    onText: (text: string) => boolean,
): (() => void) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let frame = 0;
    let stopped = false;
    // 映像の (x, y) から幅 width・高さ height を、長い辺が SCAN_SIZE 以下になるよう縮めて読む
    const read = (x: number, y: number, width: number, height: number) => {
        if (!context) return null;
        const scale = Math.min(1, SCAN_SIZE / Math.max(width, height));
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        context.drawImage(video, x, y, width, height, 0, 0, canvas.width, canvas.height);
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        return jsQR(image.data, image.width, image.height, {
            inversionAttempts: "dontInvert",
        });
    };
    let cropTurn = false;
    const tick = () => {
        if (stopped) return;
        const { videoWidth: width, videoHeight: height } = video;
        if (video.readyState >= video.HAVE_CURRENT_DATA && width > 0) {
            // 全体と、真ん中の正方形（細かい QR を大きく読むため）を、1 フレームおきに交互に読む
            const side = Math.min(width, height);
            const found = cropTurn
                ? read((width - side) / 2, (height - side) / 2, side, side)
                : read(0, 0, width, height);
            cropTurn = !cropTurn;
            if (found && onText(found.data)) {
                stopped = true;
                return;
            }
        }
        frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
        stopped = true;
        cancelAnimationFrame(frame);
    };
};
