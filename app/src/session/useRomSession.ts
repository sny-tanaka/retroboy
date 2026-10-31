// 画面の状態とロジック（ROM の保存・自動読み込み・起動・停止・セーブステート）。
// セーブステートは、画面の「セーブ」「ロード」が端末内の枠（ROM ごとに 1 件）を、メニューが .rbs ファイルを使う。
// 見た目（App.tsx）からはこのフックの戻り値だけを使う。③ で見た目を差し替えるときもここは変えずに済むようにする。
//
// GBA の ROM（.gba。storage/romSystem.ts で見分ける）は mGBA（gba/）で動かす。ROM の登録・自動読み込み・
// ゲーム内セーブ・セーブステートは Game Boy と同じ流れで、倍速と通信ケーブルは使えない（×1 に固定し、つないで
// いれば切る）。
//
// 起動の流れ（設計書 4 章）:
//   起動 → IndexedDB の lastRomId → その ROM を読む → 「タップして開始」 → initializeEmulator
// 音で進行する作りで、iOS は AudioContext をユーザー操作の中で作らないと音もループも進まないため、
// 起動直後の自動読み込みでは開始のタップを 1 回挟む。一覧から選んだときや ROM を追加したときは
// そのタップ（クリック）の中で AudioContext を用意するので、読み込み後すぐに始める。
import { useEffect, useRef, useState } from "react";

import {
    EmulatorSettings,
    initializeEmulator,
    resetEmulator,
} from "../core/retroboyCore";
import {
    flushPendingSaves,
    onSaveError,
    setActiveRomId,
} from "../emulator/cartridgeEffects";
import { resetPerfStats } from "../emulator/perfStats";
import {
    applyGbaStateFile,
    applySaveStateBytes,
    captureSaveState,
    downloadSaveState,
    loadSaveStateFile,
} from "../emulator/saveState";
import useAudioSync from "../emulator/useAudioSync";
import { useKeyListeners } from "../emulator/useKeyListeners";
import { getGbaLinkCore, startGba, stopGba } from "../gba/gbaSession";
import useGbaLoop from "../gba/useGbaLoop";
import { retroboyLinkCore } from "../link/linkCore";
import {
    setLocalGame,
    setLocalPlaying,
    useLinkStatus,
} from "../link/linkStore";
import {
    BUILTIN_GAMES,
    builtinLastRomId,
    carryOverSave,
    cleanUpOldSaves,
    deleteOldBuiltinSaves,
    findBuiltinBySha,
    listOldBuiltinSaves,
    loadBuiltinRom,
    resolveBuiltinLastRomId,
} from "../storage/builtinGames";
import {
    getLastRomId,
    getSaveState,
    importRom,
    listRoms,
    loadRom,
    putSaveState,
    type RomRecord,
    RomStorageError,
    type RomSummary,
    setLastRomId,
} from "../storage/romDb";
import { detectRomSystem, type RomSystem } from "../storage/romSystem";
import {
    requestPersistentStorage,
    type StorageStatus,
} from "../storage/storageStatus";

export type SessionStatus =
    // IndexedDB を開いて前回の ROM を探している
    | { readonly kind: "booting" }
    // 前回の ROM が無い（初回など）。ROM の追加か一覧からの選択を待つ
    | { readonly kind: "noRom" }
    | { readonly kind: "loading"; readonly message: string }
    // ROM は読めた。開始のタップを待つ
    | {
          readonly kind: "ready";
          readonly rom: RomSummary;
          readonly system: RomSystem;
      }
    | {
          readonly kind: "running";
          readonly rom: RomSummary;
          readonly system: RomSystem;
          readonly title: string;
          readonly paused: boolean;
      }
    | {
          readonly kind: "error";
          readonly message: string;
          readonly retry: () => void;
      };

// いまの ROM のセーブステートの枠
export type SaveSlot =
    // 端末から読んでいる
    | { readonly kind: "checking" }
    | { readonly kind: "empty" }
    | {
          readonly kind: "saved";
          readonly savedAt: number;
          // セーブしたときのゲーム画面（PNG）。画像を足す前のセーブには無い
          readonly screenshot?: Blob;
      }
    // 読めなかった（ロードを押せば改めて読む）
    | { readonly kind: "unreadable" };

// 「セーブしました」などを出しておく時間と、そのうち最後の消えていく時間（gbc.css の .gbc-flash[data-leaving] と同じ）
const FLASH_MS = 1500;
const FLASH_FADE_MS = 375;

const PNG_TYPE = "image/png";

/**
 * ゲーム画面（canvas）を PNG にする。toBlob は呼んだ時点の絵を写すので、押した瞬間の画面になる。
 * 作れなかったら null（画像なしでセーブする）
 */
const captureScreen = (
    canvas: HTMLCanvasElement | null | undefined,
): Promise<Blob | null> =>
    new Promise(resolve => {
        if (!canvas) {
            resolve(null);
            return;
        }
        try {
            canvas.toBlob(resolve, PNG_TYPE);
        } catch {
            resolve(null);
        }
    });

type GameBoyMode = "DMG" | "CGB";

// ヘッダの CGB フラグ（0x143 の bit 7）が立っているか、本家と同じく .gbc ならカラーで動かす
const detectMode = (rom: RomRecord): GameBoyMode => {
    const cgbFlag = new Uint8Array(rom.data)[0x143] ?? 0;
    return (cgbFlag & 0x80) !== 0 || rom.name.toLowerCase().endsWith(".gbc")
        ? "CGB"
        : "DMG";
};

// コアはヘッダの RAM サイズ（0x149）が 0〜5 以外だとエラーを返さず panic し、WASM が使えなくなる。
// その前にここで弾く（本家 smparsons/retroboy の src/address_bus/cartridge.rs の set_ram_size）
const hasValidRamSize = (rom: RomRecord): boolean =>
    (new Uint8Array(rom.data)[0x149] ?? 0xff) <= 0x05;

// 既存のロード処理（initializeEmulator）に ROM を渡す。セーブ RAM の復元もこの中で行われる
const loadIntoCore = (
    rom: RomRecord,
    sampleRate: number,
): { title: string } | { error: string } => {
    if (!hasValidRamSize(rom)) {
        return {
            error: "ROM のヘッダが壊れているか、Game Boy の ROM ではありません。",
        };
    }
    // 本家と同じく、ROM を読む前に必ずエミュレーターを作り直す。通信ケーブルからも外す。GBA が動いていれば止める
    flushPendingSaves();
    stopGba();
    setLocalGame(null);
    resetEmulator();
    // initializeEmulator の中でセーブ RAM が読まれるので、その前にキーを ROM の ID にする
    setActiveRomId(rom.id);
    try {
        const { error, metadata } = initializeEmulator(
            new Uint8Array(rom.data),
            new EmulatorSettings(detectMode(rom), sampleRate),
        );
        if (!error && metadata) {
            return { title: metadata.title };
        }
        resetEmulator();
        setActiveRomId(null);
        return { error: error ?? "" };
    } catch (err) {
        console.error("initializeEmulator failed:", err);
        try {
            resetEmulator();
        } catch (resetErr) {
            console.error("resetEmulator failed:", resetErr);
        }
        setActiveRomId(null);
        return { error: "" };
    }
};

const toSummary = ({ id, name, createdAt }: RomRecord): RomSummary => ({
    id,
    name,
    createdAt,
});

// 倍速ボタンで回る速さ（この順に回る）
export const GAME_SPEEDS = [1, 1.5, 2] as const;
export type GameSpeed = (typeof GAME_SPEEDS)[number];

const messageOf = (err: unknown, fallback: string): string =>
    err instanceof RomStorageError ? err.message : fallback;

const useRomSession = () => {
    const [status, setStatus] = useState<SessionStatus>({ kind: "booting" });
    const [roms, setRoms] = useState<RomSummary[]>([]);
    // 遊ぶのは続けられる失敗（ゲーム内セーブの保存失敗など）
    const [notice, setNotice] = useState<string | null>(null);
    const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(
        null,
    );
    // ready / running の ROM の本体（止めたあとにもう一度始めるのに使う）。状態には一覧と同じ要約だけを置く
    const currentRomRef = useRef<RomRecord | null>(null);
    const bootedRef = useRef(false);
    // セーブステートの枠。どの ROM のものかと一緒に持ち、ROM が変わったら読み直すまで "checking" とみなす
    const [slotState, setSlotState] = useState<{
        readonly romId: string;
        readonly slot: SaveSlot;
    } | null>(null);
    // 一瞬だけ出す知らせ（「セーブしました」など）。leaving は消えていくところ
    const [flash, setFlash] = useState<{
        readonly message: string;
        readonly leaving: boolean;
    } | null>(null);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 枠への書き込み・読み出しを 1 本の列に並べる。連打しても押した順に書き、ロードは手前のセーブの完了を待つ
    const slotQueueRef = useRef<Promise<unknown>>(Promise.resolve());
    // 読み込みの世代。「再試行」の連打などで読み込みが並んだとき、古い結果で状態を上書きしない
    const requestRef = useRef(0);

    // 新しい読み込みを始める。戻り値は「まだこの読み込みが最新か」
    const beginRequest = (): (() => boolean) => {
        const request = ++requestRef.current;
        return () => request === requestRef.current;
    };

    // 非同期の処理の終わりで「まだ同じ ROM か」を確かめるための、最新の値
    const slotRomIdRef = useRef<string | null>(null);
    const runningRomIdRef = useRef<string | null>(null);
    useEffect(() => {
        slotRomIdRef.current =
            status.kind === "ready" || status.kind === "running"
                ? status.rom.id
                : null;
        runningRomIdRef.current =
            status.kind === "running" ? status.rom.id : null;
    }, [status]);

    const playing = status.kind === "running" && !status.paused;
    const paused = status.kind === "running" && status.paused;
    // いま読み込んでいる ROM の本体（開始待ち・遊んでいる）
    const system: RomSystem | null =
        status.kind === "ready" || status.kind === "running"
            ? status.system
            : null;
    const gba = system === "gba";

    useKeyListeners(playing);

    // 通信ケーブル（link/）。つないでいる間は ×1 に固定し、ロードできなくする（docs/link-cable-design.md 2.3・3.4）
    const link = useLinkStatus();
    const linked = link?.phase.kind === "open";
    // 非同期の処理の終わりで、いまつないでいるかを見る
    const linkedRef = useRef(linked);
    useEffect(() => {
        linkedRef.current = linked;
    }, [linked]);
    useEffect(() => setLocalPlaying(playing), [playing]);

    // 倍速。覚えない（起動時は ×1）。ROM を始めるとき・止めたときにも ×1 に戻す。
    // 通信ケーブルでつないでいる間は ×1 に固定する（切ったあとも ×1 のまま）
    const [chosenSpeed, setSpeed] = useState<GameSpeed>(1);
    // つないだときに ×1 に戻す（描画の中で前の値と比べる。React の「props が変わったら state を合わせる」書き方）
    const [wasLinked, setWasLinked] = useState(linked);
    if (linked !== wasLinked) {
        setWasLinked(linked);
        if (linked) setSpeed(1);
    }
    // GBA は倍速を使えない
    const speed: GameSpeed = linked || gba ? 1 : chosenSpeed;
    const cycleSpeed = (): void => {
        if (linked || gba) return;
        setSpeed(current => {
            const next = GAME_SPEEDS.indexOf(current) + 1;
            return GAME_SPEEDS[next % GAME_SPEEDS.length];
        });
    };

    // 停止（本家のリセット）。同じ ROM の「タップして開始」に戻る
    const stopGame = (): void => {
        flushPendingSaves();
        stopGba();
        setLocalGame(null);
        resetEmulator();
        setActiveRomId(null);
        setSpeed(1);
        setStatus(current =>
            current.kind === "running"
                ? { kind: "ready", rom: current.rom, system: current.system }
                : current,
        );
    };

    const [audioContextRef, startReset] = useAudioSync(
        playing && !gba,
        stopGame,
        speed,
    );
    useGbaLoop(playing && gba, audioContextRef);

    // ユーザー操作（クリック・タップ）の中で呼ぶ
    const unlockAudio = (): void => {
        const audioContext = audioContextRef.current;
        if (!audioContext) {
            audioContextRef.current = new AudioContext();
        } else if (audioContext.state === "suspended") {
            void audioContext.resume();
        }
    };

    const waitForTap =(rom: RomRecord): void => {
        currentRomRef.current = rom;
        setStatus({
            kind: "ready",
            rom: toSummary(rom),
            system: detectRomSystem(rom.name, rom.data),
        });
    };

    // GBA の ROM を始める。mGBA を初めて使うときは読み込むので、少し待つ
    const startGbaRom = async (
        rom: RomRecord,
        sampleRate: number,
        isCurrent: () => boolean,
    ): Promise<void> => {
        // Game Boy のコアを止める（通信ケーブルからも外す。つながりは切らず、GBA を始めたらつなぎ直す）
        flushPendingSaves();
        setLocalGame(null);
        resetEmulator();
        setActiveRomId(null);
        setStatus({ kind: "loading", message: "GBA のエミュレーターを準備中…" });
        const result = await startGba(rom.id, rom.data, sampleRate, isCurrent);
        if (result === "cancelled") return;
        if ("error" in result) {
            setStatus({
                kind: "error",
                message: `「${rom.name}」を起動できませんでした。${result.error}`,
                retry: () => {
                    unlockAudio();
                    startRom(rom);
                },
            });
            return;
        }
        currentRomRef.current = rom;
        setSpeed(1);
        resetPerfStats();
        // mGBA でゲームを始めたあとで、通信ケーブルにつなぐ（つながっていれば時刻を 0 からそろえ直す）
        const linkCore = getGbaLinkCore();
        if (linkCore) {
            setLocalGame({ title: result.title, system: "gba", core: linkCore });
        }
        setStatus({
            kind: "running",
            rom: toSummary(rom),
            system: "gba",
            title: result.title,
            paused: false,
        });
    };

    const startRom = (rom: RomRecord): void => {
        // 途中の読み込みがあれば、その結果で始めたゲームを上書きしないようにする
        const isCurrent = beginRequest();
        const audioContext = audioContextRef.current;
        if (!audioContext) {
            waitForTap(rom);
            return;
        }
        // 内蔵ソフトは、版が上がっていたら前の版のゲーム内セーブを写してから読み込む
        // （前の ROM の書き込み待ちを先に書き出しておく）
        const builtin = findBuiltinBySha(rom.id);
        if (builtin) {
            flushPendingSaves();
            carryOverSave(builtin);
        }
        if (detectRomSystem(rom.name, rom.data) === "gba") {
            void startGbaRom(rom, audioContext.sampleRate, isCurrent);
            return;
        }
        const result = loadIntoCore(rom, audioContext.sampleRate);
        if ("error" in result) {
            setStatus({
                kind: "error",
                message: `「${rom.name}」を起動できませんでした。${result.error}`,
                retry: () => {
                    unlockAudio();
                    startRom(rom);
                },
            });
            return;
        }
        currentRomRef.current = rom;
        setSpeed(1);
        resetPerfStats();
        // コアを作り直したあとで、通信ケーブルにつなぐ（つながっていれば時刻を 0 からそろえ直す）
        setLocalGame({
            title: result.title,
            system: detectMode(rom) === "CGB" ? "cgb" : "gb",
            core: retroboyLinkCore,
        });
        setStatus({
            kind: "running",
            rom: toSummary(rom),
            system: "gb",
            title: result.title,
            paused: false,
        });
    };

    // 読み込みのあと。AudioContext がもう動いていればそのまま始め、そうでなければ開始のタップを待つ
    const startOrWaitForTap = (rom: RomRecord): void => {
        if (audioContextRef.current?.state === "running") {
            startRom(rom);
        } else {
            waitForTap(rom);
        }
    };

    // 利用者が追加した ROM。内蔵ソフトと同じ中身のもの（通信テストをファイルで追加していた等）は
    // 内蔵ソフトの欄に出るので、ここには出さない（どちらから選んでも ID が同じなのでセーブも同じ）
    const refreshRoms = async (): Promise<void> => {
        try {
            setRoms(
                (await listRoms()).filter(rom => !findBuiltinBySha(rom.id)),
            );
        } catch (err) {
            setNotice(messageOf(err, "ROM の一覧を読み込めませんでした。"));
        }
    };

    // 保存済みの ROM か内蔵ソフトを読んで、開始できるなら始める（できなければタップ待ち）
    const openRom = async (id: string, remember: boolean): Promise<void> => {
        const isCurrent = beginRequest();
        setStatus({ kind: "loading", message: "ROM を読み込み中…" });
        const builtin = findBuiltinBySha(id);
        try {
            const rom = builtin
                ? await loadBuiltinRom(builtin)
                : await loadRom(id);
            if (!isCurrent()) return;
            if (remember) {
                // 記録できなくても遊ぶのは続けられる。内蔵ソフトは版が上がっても開けるよう "builtin:<id>" で覚える
                const lastRomId = builtin ? builtinLastRomId(builtin) : id;
                setLastRomId(lastRomId).catch((err: unknown) =>
                    setNotice(messageOf(err, "前回の ROM を記録できませんでした。")),
                );
            }
            startOrWaitForTap(rom);
        } catch (err) {
            if (!isCurrent()) return;
            setStatus({
                kind: "error",
                message: messageOf(err, "保存した ROM を読み込めませんでした。"),
                retry: () => {
                    unlockAudio();
                    void openRom(id, remember);
                },
            });
        }
    };

    const boot = async (): Promise<void> => {
        const isCurrent = beginRequest();
        setStatus({ kind: "booting" });
        try {
            const [lastRomId] = await Promise.all([getLastRomId(), refreshRoms()]);
            if (!isCurrent()) return;
            // 内蔵ソフトは "builtin:<id>" で覚えている。いまの版の ID にする（無くなっていれば null）
            const builtinRomId =
                lastRomId === null ? null : resolveBuiltinLastRomId(lastRomId);
            const romId = builtinRomId === undefined ? lastRomId : builtinRomId;
            if (romId) {
                await openRom(romId, false);
            } else {
                setStatus({ kind: "noRom" });
            }
        } catch (err) {
            if (!isCurrent()) return;
            setStatus({
                kind: "error",
                message: messageOf(err, "保存した ROM を読み込めませんでした。"),
                retry: () => {
                    unlockAudio();
                    void boot();
                },
            });
        }
    };

    useEffect(() => {
        // StrictMode の二重実行で 2 回読み込まないようにする
        if (bootedRef.current) return;
        bootedRef.current = true;
        void requestPersistentStorage().then(setStorageStatus);
        // 内蔵ソフトの古い版のセーブの掃除は、前回の ROM を開き終えてから（画面に知らせは出さない）
        void boot().then(cleanUpOldSaves);
    }, []);

    useEffect(() => onSaveError(setNotice), []);

    // 枠を持つ ROM（開始待ち・遊んでいる）
    const slotRomId =
        status.kind === "ready" || status.kind === "running"
            ? status.rom.id
            : null;
    const slot: SaveSlot =
        slotState && slotState.romId === slotRomId
            ? slotState.slot
            : { kind: "checking" };

    const setSlotFor = (romId: string, next: SaveSlot): void =>
        setSlotState({ romId, slot: next });

    // ROM が変わったら、その ROM の枠に保存があるかを読む
    useEffect(() => {
        if (!slotRomId) return;
        let alive = true;
        const romId = slotRomId;
        const check = enqueueSlot(() => getSaveState(romId));
        check
            .then(record => {
                if (!alive) return;
                setSlotFor(
                    romId,
                    record
                        ? {
                              kind: "saved",
                              savedAt: record.savedAt,
                              screenshot:
                                  record.screenshot &&
                                  new Blob([record.screenshot], {
                                      type: PNG_TYPE,
                                  }),
                          }
                        : { kind: "empty" },
                );
            })
            .catch(() => {
                if (alive) setSlotFor(romId, { kind: "unreadable" });
            });
        return () => {
            alive = false;
        };
    }, [slotRomId]);

    useEffect(
        () => () => {
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        },
        [],
    );

    // 「タップして開始」
    const startReadyRom = (): void => {
        const rom = currentRomRef.current;
        if (!rom) return;
        unlockAudio();
        startRom(rom);
    };

    // 一覧から選ぶ（クリックの中で呼ぶ）
    const selectRom = (id: string): void => {
        unlockAudio();
        void openRom(id, true);
    };

    // ファイル選択の前（「ROM を追加」のクリックの中）で unlockAudio を呼んでおくと、保存後すぐに始まる
    const addRomFile = async (file: File): Promise<void> => {
        const isCurrent = beginRequest();
        setStatus({ kind: "loading", message: "ROM を端末に保存中…" });
        try {
            const rom = await importRom(file);
            await refreshRoms();
            if (!isCurrent()) return;
            startOrWaitForTap(rom);
        } catch (err) {
            if (!isCurrent()) return;
            setStatus({
                kind: "error",
                message: messageOf(err, "ROM を端末に保存できませんでした。"),
                retry: () => {
                    unlockAudio();
                    void addRomFile(file);
                },
            });
        }
    };

    const pause = (): void =>
        setStatus(current =>
            current.kind === "running" ? { ...current, paused: true } : current,
        );

    const resume = (): void =>
        setStatus(current =>
            current.kind === "running" ? { ...current, paused: false } : current,
        );

    const showFlash = (message: string): void => {
        // 出ている間に続けて出すときは、出し直さず（フェードをやり直さず）文言と時間だけ変える。
        // 連打で知らせが明滅しないように
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        setFlash({ message, leaving: false });
        flashTimerRef.current = setTimeout(() => {
            setFlash({ message, leaving: true });
            flashTimerRef.current = setTimeout(() => {
                flashTimerRef.current = null;
                setFlash(null);
            }, FLASH_FADE_MS);
        }, FLASH_MS - FLASH_FADE_MS);
    };

    // 枠の処理を列の最後に足す（前の処理が失敗しても続ける）
    function enqueueSlot<T>(task: () => Promise<T>): Promise<T> {
        const next = slotQueueRef.current.then(task, task);
        slotQueueRef.current = next.catch(() => undefined);
        return next;
    }

    // 画面の「セーブ」。押した瞬間の状態と画面（screen）を取り、ROM の枠に上書きする（ゲームは止めない）
    const saveToSlot = (screen?: HTMLCanvasElement | null): void => {
        if (status.kind !== "running") return;
        const romId = status.rom.id;
        const captured = captureSaveState();
        if ("error" in captured) {
            setNotice(
                `セーブできませんでした。${captured.error}`.trim(),
            );
            return;
        }
        const shot = captureScreen(screen);
        void enqueueSlot(async () => {
            // 画像を作れなくてもセーブはする（ロードの確認が日時だけになる）
            const screenshot = (await shot) ?? undefined;
            const bytes = await screenshot
                ?.arrayBuffer()
                .catch(() => undefined);
            const savedAt = await putSaveState(romId, captured.data, bytes);
            return { savedAt, screenshot: bytes && screenshot };
        }).then(
            ({ savedAt, screenshot }) => {
                // 書き終わる前に ROM を切り替えていたら、枠の表示も知らせも出さない（切り替え先の枠は別に読む）
                if (romId !== slotRomIdRef.current) return;
                setSlotFor(romId, { kind: "saved", savedAt, screenshot });
                showFlash("セーブしました");
            },
            (err: unknown) =>
                setNotice(messageOf(err, "セーブできませんでした。")),
        );
    };

    // 画面の「ロード」（確認のあと）。ROM の枠から戻す。手前のセーブが終わるのを待ってから読む
    const loadFromSlot = async (): Promise<void> => {
        if (status.kind !== "running" || linked) return;
        const romId = status.rom.id;
        try {
            const record = await enqueueSlot(() => getSaveState(romId));
            // 読んでいる間に ROM を切り替えた・止めたなら、何もしない
            if (romId !== runningRomIdRef.current) return;
            if (!record) {
                setSlotFor(romId, { kind: "empty" });
                showFlash("セーブがありません");
                return;
            }
            // 読んでいる間につないだなら、ロードしない（片方だけ時を戻すと相手と食い違う）
            if (linkedRef.current) return;
            const error = applySaveStateBytes(new Uint8Array(record.data));
            if (error !== null) {
                setNotice(`ロードできませんでした。${error}`.trim());
                return;
            }
            showFlash("ロードしました");
        } catch (err) {
            setNotice(messageOf(err, "セーブを読み込めませんでした。"));
        }
    };

    // メニューの「ファイルに書き出す」
    const exportStateFile = (): void => {
        if (status.kind === "running") {
            setNotice(downloadSaveState(status.rom.name));
        }
    };

    // ゲーム内セーブを含む .ss1 を読んで、置き換えるかを聞いている間の、そのファイル（どの ROM で読んだかと一緒に）
    const [askingStateSave, setAskingStateSave] = useState<{
        readonly romId: string;
        readonly data: Uint8Array;
    } | null>(null);

    // メニューの「ファイルから読み込む」。ゲーム内セーブを含む .ss1 なら、適用せずに置き換えるかを聞く（true を返す）
    const loadState = async (file: File): Promise<boolean> => {
        if (linkedRef.current) return false;
        const romId = runningRomIdRef.current;
        const result = await loadSaveStateFile(file);
        if (result.kind === "done") {
            setNotice(result.error);
            return false;
        }
        // 読んでいる間に ROM を切り替えた・止めた・つないだなら、何もしない
        if (!romId || romId !== runningRomIdRef.current || linkedRef.current) {
            return false;
        }
        setAskingStateSave({ romId, data: result.data });
        return true;
    };

    // 上の問いの答え。はい（withSave）なら状態とゲーム内セーブ、いいえなら状態だけを戻す
    const answerStateSave = (withSave: boolean): void => {
        const asking = askingStateSave;
        setAskingStateSave(null);
        if (
            !asking ||
            asking.romId !== runningRomIdRef.current ||
            linkedRef.current
        ) {
            return;
        }
        setNotice(applyGbaStateFile(asking.data, withSave));
    };

    // メニューの「古い版のセーブを消す」で消せる内蔵ソフトの古い版（メニューを出すときに数える）
    const listOldSaves = (): { name: string; versions: number }[] =>
        listOldBuiltinSaves(roms.map(rom => rom.id));

    // メニューの「古い版のセーブを消す」の確認で「消す」
    const deleteOldSaves = async (): Promise<void> => {
        try {
            await deleteOldBuiltinSaves();
            setNotice("内蔵ソフトの古い版のゲーム内セーブを消しました。");
        } catch (err) {
            setNotice(messageOf(err, "古い版のゲーム内セーブを消せませんでした。"));
        }
    };

    return {
        status,
        system,
        playing,
        paused,
        roms,
        builtinGames: BUILTIN_GAMES,
        notice,
        dismissNotice: () => setNotice(null),
        storageStatus,
        unlockAudio,
        startReadyRom,
        selectRom,
        addRomFile,
        pause,
        resume,
        speed,
        cycleSpeed,
        link,
        stop: startReset,
        slot,
        flash,
        saveToSlot,
        loadFromSlot,
        exportStateFile,
        loadState,
        // 問いを出すのは、読んだ ROM がまだ動いている間だけ
        askingStateSave:
            askingStateSave !== null &&
            status.kind === "running" &&
            askingStateSave.romId === status.rom.id,
        answerStateSave,
        listOldSaves,
        deleteOldSaves,
    };
};

export default useRomSession;
