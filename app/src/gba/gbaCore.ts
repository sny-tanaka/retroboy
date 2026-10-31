// GBA のコア（mGBA の WASM。scripts/build-mgba.sh が app/src/gba/core/ に作る）を TS から使う口。
// Game Boy の Retro Boy とは別のコアで、GBA の ROM を始めるときに初めて読み込む（最初の起動を重くしない）。
// スレッドは使わない（SharedArrayBuffer は要らない）。1 回の runFrame で 1 フレーム進め、その分の絵と音を取り出す。
import createMgbaCore, { type MgbaModule } from "./core/mgbaCore.js";
import wasmUrl from "./core/mgbaCore.wasm?url";

import type { LinkCore } from "../link/linkCore";

export const GBA_WIDTH = 240;
export const GBA_HEIGHT = 160;

// GBA の CPU のサイクル（通信用の時刻の単位）
const GBA_CYCLES_PER_SECOND = 16 * 1024 * 1024;
// 1 フレーム（228 行 × 1232 サイクル）
const GBA_FRAME_CYCLES = 280896;
// gba_link_take_event の種類（mgba-glue.c の LINK_EVENT_*）
const GBA_LINK_TRANSFER = 0;
const GBA_LINK_REPLY = 1;
const GBA_LINK_SO = 2;

// mGBA のボタンのビット（mgba-glue.c の gba_set_keys）
export const GBA_KEY_BITS: Readonly<Record<string, number>> = {
    A: 1 << 0,
    B: 1 << 1,
    Select: 1 << 2,
    Start: 1 << 3,
    Right: 1 << 4,
    Left: 1 << 5,
    Up: 1 << 6,
    Down: 1 << 7,
    R: 1 << 8,
    L: 1 << 9,
};

const SAVE_MAX = 128 * 1024;

export class GbaCore {
    private readonly module: MgbaModule;
    /** 1 秒あたりのフレームの数（GBA は 59.7275） */
    readonly frameRate: number;
    private readonly image: ImageData;

    private constructor(module: MgbaModule, frameRate: number) {
        this.module = module;
        this.frameRate = frameRate;
        this.image = new ImageData(GBA_WIDTH, GBA_HEIGHT);
    }

    /** ROM を読み込む（前の ROM は捨てる）。save はゲーム内セーブ（無ければ null）。失敗したらエラー文 */
    static create(
        module: MgbaModule,
        rom: ArrayBuffer,
        save: Uint8Array | null,
        sampleRate: number,
    ): GbaCore | { error: string } {
        const romPointer = module._gba_alloc_rom(rom.byteLength);
        if (!romPointer) return { error: "メモリが足りません。" };
        module.HEAPU8.set(new Uint8Array(rom), romPointer);
        if (save && save.length > 0) {
            module.HEAPU8.set(
                save.subarray(0, SAVE_MAX),
                module._gba_save_buffer(),
            );
        }
        const result = module._gba_load(rom.byteLength, sampleRate);
        if (result !== 0) {
            module._gba_unload();
            return { error: "GBA の ROM として読めませんでした。" };
        }
        return new GbaCore(module, module._gba_frame_rate_milli() / 1000);
    }

    unload(): void {
        this.module._gba_unload();
    }

    setKeys(keys: number): void {
        this.module._gba_set_keys(keys);
    }

    /** 1 フレーム進め、そのフレームの音（左右）を返す。返す配列はコピーなので持っていてよい */
    runFrame(): [Float32Array, Float32Array] {
        const module = this.module;
        const count = module._gba_run_frame();
        const left = module._gba_audio_left() >> 2;
        const right = module._gba_audio_right() >> 2;
        return [
            module.HEAPF32.slice(left, left + count),
            module.HEAPF32.slice(right, right + count),
        ];
    }

    /** linkStep が 1 フレームの区切り（STEP_AUDIO）を返したあとに、そのフレームの音を取り出す（runFrame と同じ形） */
    takeFrameAudio(): [Float32Array, Float32Array] {
        const module = this.module;
        const count = module._gba_take_audio();
        const left = module._gba_audio_left() >> 2;
        const right = module._gba_audio_right() >> 2;
        return [
            module.HEAPF32.slice(left, left + count),
            module.HEAPF32.slice(right, right + count),
        ];
    }

    /** 通信ケーブルの口（mgba-glue.c の gba_link_*。link/linkCore.ts の LinkCore の形にする） */
    linkCore(releaseKey: (key: string) => void): LinkCore {
        const module = this.module;
        return {
            cyclesPerMs: GBA_CYCLES_PER_SECOND / 1000,
            frameCycles: GBA_FRAME_CYCLES,
            setConnected: connected =>
                module._gba_link_set_connected(connected ? 1 : 0),
            step: limit => module._gba_link_step(limit),
            clock: () => module._gba_link_clock(),
            takeEvent: () => {
                const kind = module._gba_link_take_event();
                switch (kind) {
                    case GBA_LINK_TRANSFER:
                        return {
                            kind: "transfer",
                            seq: module._gba_link_event_seq() >>> 0,
                            at: module._gba_link_event_at(),
                            data: module._gba_link_event_data() >>> 0,
                            bits: module._gba_link_event_bits(),
                        };
                    case GBA_LINK_REPLY:
                        return {
                            kind: "reply",
                            seq: module._gba_link_event_seq() >>> 0,
                            data: module._gba_link_event_data() >>> 0,
                        };
                    case GBA_LINK_SO:
                        return {
                            kind: "so",
                            at: module._gba_link_event_at(),
                            level: module._gba_link_event_bits(),
                        };
                    default:
                        return null;
                }
            },
            deliverTransfer: (seq, at, data, bits) =>
                module._gba_link_deliver_transfer(seq, at, data, bits),
            deliverReply: (seq, data) =>
                module._gba_link_deliver_reply(seq, data),
            deliverSo: (at, level) => module._gba_link_deliver_so(at, level),
            releaseKey,
        };
    }

    /** いまの絵を canvas に描く */
    draw(context: CanvasRenderingContext2D): void {
        const pointer = this.module._gba_video();
        this.image.data.set(
            this.module.HEAPU8.subarray(
                pointer,
                pointer + GBA_WIDTH * GBA_HEIGHT * 4,
            ),
        );
        context.putImageData(this.image, 0, 0);
    }

    /** ゲームの名前（ヘッダの 12 文字） */
    title(): string {
        const pointer = this.module._malloc(16);
        try {
            this.module._gba_title(pointer);
            const bytes = this.module.HEAPU8.subarray(pointer, pointer + 16);
            const end = bytes.indexOf(0);
            return String.fromCharCode(
                ...bytes.subarray(0, end < 0 ? 16 : end),
            ).trim();
        } finally {
            this.module._free(pointer);
        }
    }

    /** ゲーム内セーブの中身のコピー。セーブを使っていない（まだ種類が決まっていない）なら null */
    saveData(): Uint8Array | null {
        const size = this.module._gba_save_size();
        if (size === 0) return null;
        const pointer = this.module._gba_save_buffer();
        return this.module.HEAPU8.slice(pointer, pointer + size);
    }

    /**
     * セーブステート（mGBA の形式）。withSave ならゲーム内セーブも含める（ファイルに書き出すとき）。
     * 作れなければ null
     */
    saveState(withSave: boolean): Uint8Array | null {
        const size = this.module._gba_state_save(withSave ? 1 : 0);
        if (size === 0) return null;
        const pointer = this.module._gba_state_buffer();
        return this.module.HEAPU8.slice(pointer, pointer + size);
    }

    /** セーブステートにゲーム内セーブが含まれているか（ファイルに書き出したもの。前の版のファイルには無い） */
    stateHasSave(data: Uint8Array): boolean {
        const pointer = this.module._gba_state_alloc(data.length);
        if (!pointer) return false;
        this.module.HEAPU8.set(data, pointer);
        return this.module._gba_state_has_save(data.length) === 1;
    }

    /**
     * セーブステートを読む。withSave なら、含まれているゲーム内セーブでいまのゲーム内セーブも置き換える。
     * 別のゲームのものや壊れたものなら "error"、状態は戻せたがゲーム内セーブは置き換えられなかったら "saveError"
     */
    loadState(
        data: Uint8Array,
        withSave: boolean,
    ): "ok" | "error" | "saveError" {
        const pointer = this.module._gba_state_alloc(data.length);
        if (!pointer) return "error";
        this.module.HEAPU8.set(data, pointer);
        const result = this.module._gba_state_load(
            data.length,
            withSave ? 1 : 0,
        );
        return result === 1 ? "ok" : result === 2 ? "saveError" : "error";
    }
}

let modulePromise: Promise<MgbaModule> | null = null;

/** mGBA の WASM を読み込む（1 回だけ。失敗したら次に呼んだときに読み直す） */
export const loadMgba = (): Promise<MgbaModule> => {
    modulePromise ??= createMgbaCore({ locateFile: () => wasmUrl }).catch(
        (err: unknown) => {
            modulePromise = null;
            throw err;
        },
    );
    return modulePromise;
};
