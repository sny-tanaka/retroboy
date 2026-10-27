// scripts/build-mgba.sh が作る mgbaCore.js（Emscripten の MODULARIZE・EXPORT_ES6）の型。
// 関数は mgba-glue.c の EMSCRIPTEN_KEEPALIVE のもの。ポインターは WASM のメモリの中の位置（number）。
// build-mgba.sh が app/src/gba/core/ に写す。

export interface MgbaModule {
    readonly HEAPU8: Uint8Array;
    readonly HEAPU32: Uint32Array;
    readonly HEAPF32: Float32Array;
    _malloc(size: number): number;
    _free(pointer: number): void;
    _gba_alloc_rom(romSize: number): number;
    _gba_save_buffer(): number;
    _gba_load(romSize: number, sampleRate: number): number;
    _gba_unload(): void;
    _gba_set_keys(keys: number): void;
    _gba_run_frame(): number;
    _gba_audio_left(): number;
    _gba_audio_right(): number;
    _gba_video(): number;
    _gba_frame_rate_milli(): number;
    _gba_save_size(): number;
    _gba_title(buffer: number): void;
    _gba_state_save(): number;
    _gba_state_buffer(): number;
    _gba_state_alloc(size: number): number;
    _gba_state_load(size: number): number;
    // 通信ケーブル（mgba-glue.c のいちばん下）
    _gba_link_set_connected(connected: number): void;
    _gba_link_clock(): number;
    _gba_link_step(limit: number): number;
    _gba_take_audio(): number;
    _gba_link_take_event(): number;
    _gba_link_event_seq(): number;
    _gba_link_event_at(): number;
    /** u32 だが JS には符号つきで届く（>>> 0 で直す） */
    _gba_link_event_data(): number;
    _gba_link_event_bits(): number;
    _gba_link_deliver_transfer(
        seq: number,
        at: number,
        data: number,
        bits: number,
    ): void;
    _gba_link_deliver_so(at: number, level: number): void;
    _gba_link_deliver_reply(seq: number, data: number): void;
}

export interface MgbaModuleOptions {
    locateFile?: (path: string, prefix: string) => string;
}

declare const createMgbaCore: (options?: MgbaModuleOptions) => Promise<MgbaModule>;
export default createMgbaCore;
