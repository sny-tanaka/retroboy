// 「通信ケーブル」でつなぐ画面の中身（docs/link-cable-design.md 4.2）。同じ Wi-Fi の 2 台が QR を往復してつなぐ。
//   A（先に始める）: 「QR を出す」→ QR ① を出す →「相手の QR を読む」→ カメラで QR ② を読む → つながる
//   B（あとから）  : 「QR を読む」→ カメラで QR ① を読む → QR ② を出す → A が読むとつながる
// QR の代わりに、コードのコピー・貼り付けでもつなげる（カメラが使えないとき・Mac で試すとき）。
// QR のライブラリを最初の起動で読み込まないよう、この画面ごと遅れて読み込む（App.tsx の lazy）。
import { useEffect, useRef, useState } from "react";

import { useLinkStatus, startLink } from "../link/linkStore";
import {
    CameraError,
    drawQr,
    openCamera,
    scanQr,
    stopCamera,
} from "../link/qr";
import { SignalError } from "../link/signal";
import { WebRtcTransport } from "../link/webrtcTransport";

type Role = "host" | "guest";

type Step =
    | { readonly kind: "choose" }
    | { readonly kind: "preparing"; readonly message: string }
    // 自分のコード（QR）を相手に見せる
    | { readonly kind: "show"; readonly role: Role; readonly code: string }
    // 相手のコード（QR）を読む
    | { readonly kind: "scan"; readonly role: Role }
    // 先に始めた側が相手の QR を読んだあと、つながるのを待つ
    | { readonly kind: "connecting" }
    | { readonly kind: "failed"; readonly message: string };

// 先に始めた側が相手の QR を読んでから、つながるまで待つ上限
const CONNECT_TIMEOUT_MS = 20000;
// 「QR を出す」で、カメラの許可を待つ上限
const CAMERA_WAIT_MS = 10000;

const CONNECT_FAILED =
    "つながりませんでした。2 台が同じ Wi-Fi につながっているか、Wi-Fi に「端末どうしの通信を禁止する」設定（ゲスト用の Wi-Fi・公衆 Wi-Fi に多い）が無いかを確かめてください。";

const messageOf = (err: unknown, fallback: string): string =>
    err instanceof SignalError || err instanceof CameraError
        ? err.message
        : fallback;

/** 自分のコードの QR と、コピーのボタン */
const CodeView = ({ code }: { readonly code: string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (canvasRef.current) drawQr(canvasRef.current, code, 4);
    }, [code]);
    const copy = (): void => {
        navigator.clipboard?.writeText(code).then(
            () => setCopied(true),
            () => setCopied(false),
        );
    };
    return (
        <div className="gbc-link-code">
            <canvas
                ref={canvasRef}
                className="gbc-link-qr"
                role="img"
                aria-label="つなぐための QR コード"
            />
            <button type="button" className="gbc-menu-item" onClick={copy}>
                {copied ? "コピーしました" : "コードをコピー"}
            </button>
            <textarea
                className="gbc-link-code-text"
                readOnly
                value={code}
                aria-label="つなぐためのコード"
                onFocus={event => event.currentTarget.select()}
            />
        </div>
    );
};

/** カメラで相手の QR を読む。読めない・使えないときのために、貼り付けの欄も出す */
const ScanView = ({
    stream,
    cameraError,
    onCode,
}: {
    readonly stream: MediaStream | null;
    readonly cameraError: string | null;
    readonly onCode: (code: string) => void;
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [pasted, setPasted] = useState("");
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !stream) return;
        video.srcObject = stream;
        void video.play().catch(() => undefined);
        const stop = scanQr(video, text => {
            if (!text.startsWith("RBL1")) return false;
            onCode(text);
            return true;
        });
        return () => {
            stop();
            video.srcObject = null;
        };
    }, [stream]);
    return (
        <div className="gbc-link-scan">
            {stream ? (
                <video
                    ref={videoRef}
                    className="gbc-link-video"
                    playsInline
                    muted
                />
            ) : (
                <p className="gbc-menu-note">
                    {cameraError ?? "カメラを開いています…"}
                </p>
            )}
            <p className="gbc-menu-note">
                読めないときは、相手のコードをコピーして（AirDrop やメッセージで送って）ここに貼り付けてください。
            </p>
            <textarea
                className="gbc-link-code-text"
                value={pasted}
                placeholder="RBL1… で始まるコード"
                aria-label="相手のコード"
                onChange={event => setPasted(event.currentTarget.value)}
            />
            <button
                type="button"
                className="gbc-menu-item"
                disabled={pasted.trim() === ""}
                onClick={() => onCode(pasted)}
            >
                このコードでつなぐ
            </button>
        </div>
    );
};

export const LinkConnect = ({
    appVersion,
    onClose,
}: {
    readonly appVersion: string;
    readonly onClose: () => void;
}) => {
    const link = useLinkStatus();
    const [step, setStep] = useState<Step>({ kind: "choose" });
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    // 先に始めた側の道（相手のコードを受け取るのに使う）
    const hostRef = useRef<WebRtcTransport | null>(null);
    // この画面を閉じたあとに、非同期の続きで状態を変えないように
    // （StrictMode では付けて外して付け直すので、付けるたびに true に戻す）
    const aliveRef = useRef(true);
    useEffect(() => {
        aliveRef.current = true;
        return () => {
            aliveRef.current = false;
        };
    }, []);

    // カメラは、閉じるときと、読み終えたときに止める
    const streamRef = useRef<MediaStream | null>(null);
    const startCamera = async (): Promise<void> => {
        if (streamRef.current) return;
        try {
            const opened = await openCamera();
            if (!aliveRef.current) {
                stopCamera(opened);
                return;
            }
            streamRef.current = opened;
            setStream(opened);
            setCameraError(null);
        } catch (err) {
            if (aliveRef.current) {
                setCameraError(messageOf(err, "カメラを開けませんでした。"));
            }
        }
    };
    const closeCamera = (): void => {
        stopCamera(streamRef.current);
        streamRef.current = null;
        setStream(null);
    };
    useEffect(() => () => stopCamera(streamRef.current), []);

    const connected = link?.phase.kind === "open";
    const lost =
        link?.phase.kind === "closed" &&
        (step.kind === "connecting" || step.kind === "show");

    // 先に始めた側: 相手の QR を読んでから一定の時間でつながらなければ、あきらめる
    useEffect(() => {
        if (step.kind !== "connecting") return;
        const timer = setTimeout(() => {
            if (aliveRef.current) {
                setStep({ kind: "failed", message: CONNECT_FAILED });
            }
        }, CONNECT_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [step.kind]);

    // 「QR を出す」。先にカメラの許可を取る（iOS の Safari は、カメラの許可が無いページでは、つなぐ相手に知らせる
    // 自分のアドレスを隠す。あとで相手の QR を読むのにもカメラが要る）。許可されなくても、貼り付けでつなげるよう進める
    const startHost = async (): Promise<void> => {
        setStep({ kind: "preparing", message: "つなぐ準備をしています…" });
        // カメラの許可を待ちすぎない（答えないまま置かれても、許可なしで進める）
        await Promise.race([
            startCamera(),
            new Promise(resolve => setTimeout(resolve, CAMERA_WAIT_MS)),
        ]);
        if (!aliveRef.current) return;
        try {
            const { transport, code } = await WebRtcTransport.createHost();
            if (!aliveRef.current) {
                transport.close();
                return;
            }
            hostRef.current = transport;
            startLink(transport, appVersion);
            setStep({ kind: "show", role: "host", code });
        } catch (err) {
            console.error("createHost failed:", err);
            if (aliveRef.current) {
                setStep({
                    kind: "failed",
                    message: messageOf(err, "つなぐ準備ができませんでした。"),
                });
            }
        }
    };

    const startGuest = (): void => {
        setStep({ kind: "scan", role: "guest" });
        void startCamera();
    };

    // 相手のコードを読んだ（QR・貼り付け）
    const handleCode = async (role: Role, code: string): Promise<void> => {
        setStep({ kind: "preparing", message: "相手のコードを読んでいます…" });
        try {
            if (role === "guest") {
                const created = await WebRtcTransport.createGuest(code);
                if (!aliveRef.current) {
                    created.transport.close();
                    return;
                }
                closeCamera();
                startLink(created.transport, appVersion);
                setStep({ kind: "show", role: "guest", code: created.code });
            } else {
                const host = hostRef.current;
                if (!host) throw new Error("no host");
                await host.acceptAnswer(code);
                if (!aliveRef.current) return;
                closeCamera();
                setStep({ kind: "connecting" });
            }
        } catch (err) {
            if (!aliveRef.current) return;
            if (err instanceof SignalError) {
                // 読み直せるよう、読む画面に戻す（文言は失敗の画面で出す）
                setStep({ kind: "failed", message: err.message });
            } else {
                console.error("link code failed:", err);
                setStep({ kind: "failed", message: CONNECT_FAILED });
            }
        }
    };

    if (connected) {
        return (
            <section className="gbc-menu-section">
                <p className="gbc-link-done">つながりました</p>
                <p className="gbc-menu-note">
                    {link.peer.kind === "running"
                        ? `相手のゲーム: ${link.peer.title}`
                        : "相手のゲームが始まると、通信できるようになります。"}
                </p>
                <p className="gbc-menu-note">
                    つないでいる間は ×1 の速さに固定し、ロードはできません。通信しているときはゲームがゆっくり進み、音が途切れます。
                </p>
                <button type="button" className="gbc-menu-item" onClick={onClose}>
                    閉じてゲームに戻る
                </button>
            </section>
        );
    }

    if (lost || step.kind === "failed") {
        return (
            <section className="gbc-menu-section">
                <p className="gbc-menu-note gbc-link-error" role="alert">
                    {step.kind === "failed" ? step.message : CONNECT_FAILED}
                </p>
                <button
                    type="button"
                    className="gbc-menu-item"
                    onClick={() => {
                        hostRef.current = null;
                        closeCamera();
                        setStep({ kind: "choose" });
                    }}
                >
                    はじめからやり直す
                </button>
            </section>
        );
    }

    switch (step.kind) {
        case "choose":
            return (
                <section className="gbc-menu-section">
                    <p className="gbc-menu-note">
                        同じ Wi-Fi につないだ 2 台で、片方は「QR を出す」、もう片方は「QR を読む」を押してください。QR を 1 回ずつ読み合うとつながります。2 台とも、つなぐゲームの ROM が要ります。
                    </p>
                    <button
                        type="button"
                        className="gbc-menu-item"
                        onClick={() => void startHost()}
                    >
                        QR を出す（先に始める）
                    </button>
                    <button
                        type="button"
                        className="gbc-menu-item"
                        onClick={startGuest}
                    >
                        QR を読む（相手の QR を読む）
                    </button>
                    <p className="gbc-menu-note">
                        Wi-Fi が無いときは、片方の「インターネット共有」にもう片方をつなぐと同じネットワークになります。
                    </p>
                </section>
            );
        case "preparing":
            return (
                <section className="gbc-menu-section">
                    <p className="gbc-menu-note" role="status">
                        {step.message}
                    </p>
                </section>
            );
        case "show":
            return (
                <section className="gbc-menu-section">
                    <p className="gbc-menu-note">
                        {step.role === "host"
                            ? "① 相手の iPhone で「QR を読む」を押し、この QR を読んでもらってください。"
                            : "② 相手の iPhone でこの QR を読んでもらってください。読まれるとつながります。"}
                    </p>
                    <CodeView code={step.code} />
                    {step.role === "host" && (
                        <button
                            type="button"
                            className="gbc-menu-item gbc-menu-add"
                            onClick={() => {
                                setStep({ kind: "scan", role: "host" });
                                void startCamera();
                            }}
                        >
                            相手の QR を読む
                        </button>
                    )}
                    {step.role === "guest" && (
                        <p className="gbc-menu-note" role="status">
                            相手が読むのを待っています…
                        </p>
                    )}
                </section>
            );
        case "scan":
            return (
                <section className="gbc-menu-section">
                    <p className="gbc-menu-note">
                        {step.role === "host"
                            ? "② 相手の画面に出た QR を読んでください。"
                            : "① 相手の画面に出ている QR を読んでください。"}
                    </p>
                    <ScanView
                        stream={stream}
                        cameraError={cameraError}
                        onCode={code => void handleCode(step.role, code)}
                    />
                </section>
            );
        case "connecting":
            return (
                <section className="gbc-menu-section">
                    <p className="gbc-menu-note" role="status">
                        つないでいます…
                    </p>
                </section>
            );
    }
};

export default LinkConnect;
