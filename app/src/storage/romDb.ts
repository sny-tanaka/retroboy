// ROM を端末内（IndexedDB）に保存する。設計書 3 章の roms / settings ストアと、
// 画面の「セーブ」「ロード」で使うセーブステートの枠（saveStates ストア、ROM ごとに 1 件）。
// ROM はここ以外へは出さない（外部への送信・ログ出力をしない）。
import { computeRomId } from "./romId";
import {
    detectRomSystem,
    MAX_GB_ROM_SIZE,
    MAX_GBA_ROM_SIZE,
    MIN_ROM_SIZE,
} from "./romSystem";

const DB_NAME = "retroboy-snap";
// 版 1: roms / settings。版 2: saveStates を足した
const DB_VERSION = 2;
const ROMS_STORE = "roms";
const SETTINGS_STORE = "settings";
const SAVE_STATES_STORE = "saveStates";
const LAST_ROM_ID_KEY = "lastRomId";

export interface RomRecord {
    readonly id: string; // ROM の中身の SHA-256（16 進）
    readonly name: string; // 画面表示用のファイル名
    readonly data: ArrayBuffer;
    readonly createdAt: number;
}

export type RomSummary = Omit<RomRecord, "data">;

// セーブステートの枠。ROM ごとに 1 件で、セーブするたびに上書きする
export interface SaveStateRecord {
    readonly romId: string;
    readonly data: ArrayBuffer;
    readonly savedAt: number;
    // セーブしたときのゲーム画面（160x144、GBA は 240x160 の PNG のバイト列）。ロードの確認に出す。
    // 足す前のセーブには無い。値に足すだけなので DB の版は上げない。
    // Blob ではなく ArrayBuffer で持つ（古い iOS の Safari は IndexedDB の Blob で失敗することがあるため）
    readonly screenshot?: ArrayBuffer;
}

interface SettingRecord {
    readonly key: string;
    readonly value: unknown;
}

// 画面にそのまま出せる文言を持つエラー
export class RomStorageError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "RomStorageError";
    }
}

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

// 書き込みはリクエストの成功ではなく、トランザクションの complete で確定する
const transactionDone = (transaction: IDBTransaction): Promise<void> => {
    const done = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
            reject(transaction.error ?? new DOMException("Aborted", "AbortError"));
    });
    // 途中のリクエストの失敗で先に抜けたときに、未処理の reject として出ないようにする
    done.catch(() => undefined);
    return done;
};

let dbPromise: Promise<IDBDatabase> | null = null;

// 古い接続の後始末が、開き直した新しい接続まで捨てないよう、自分のときだけ消す
const forget = (promise: Promise<IDBDatabase>): void => {
    if (dbPromise === promise) {
        dbPromise = null;
    }
};

const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    const promise: Promise<IDBDatabase> = new Promise<IDBDatabase>(
        (resolve, reject) => {
            if (typeof indexedDB === "undefined") {
                reject(new Error("IndexedDB is not available"));
                return;
            }
            let blocked = false;
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                // 版を上げるときは既存のストアを消さずに足すこと（保存済みの ROM が消える）
                const db = request.result;
                if (!db.objectStoreNames.contains(ROMS_STORE)) {
                    db.createObjectStore(ROMS_STORE, { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                    db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
                }
                if (!db.objectStoreNames.contains(SAVE_STATES_STORE)) {
                    db.createObjectStore(SAVE_STATES_STORE, { keyPath: "romId" });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                // blocked で先に諦めたあとに開けたときは、使わないので閉じる（ほかの版上げを止めないように）
                if (blocked) {
                    db.close();
                    return;
                }
                // 別のタブが新しい版で開こうとしたら閉じて譲る（次の呼び出しで開き直す）
                db.onversionchange = () => {
                    db.close();
                    forget(promise);
                };
                db.onclose = () => forget(promise);
                resolve(db);
            };
            request.onerror = () => reject(request.error);
            // 版上げのとき、古い版のまま開いている別のタブ・ウィンドウが閉じてくれないと待たされる。
            // 待ち続けず知らせる（このアプリの版 1 以降は versionchange で閉じるので、ふつうは起きない）
            request.onblocked = () => {
                blocked = true;
                reject(
                    new RomStorageError(
                        "別のタブかウィンドウで、このアプリの古い版が開いています。閉じてから再試行してください。",
                    ),
                );
            };
        },
    ).catch((err: unknown) => {
        // 失敗を覚えておかず、再試行で開き直せるようにする
        forget(promise);
        throw err;
    });
    dbPromise = promise;
    return promise;
};

// iOS はバックグラウンドから戻ると接続が切れていることがあり（"Connection to Indexed Database server lost"）、
// onclose が来ないまま db.transaction() などが InvalidStateError / UnknownError で失敗する。
// そのときは接続を捨てて開き直し、1 回だけやり直す（失敗したトランザクションは何も書いていない）
const isConnectionLost = (err: unknown): boolean =>
    err instanceof DOMException &&
    (err.name === "InvalidStateError" || err.name === "UnknownError");

const withDb = async <T>(run: (db: IDBDatabase) => Promise<T>): Promise<T> => {
    const promise = openDb();
    const db = await promise;
    try {
        return await run(db);
    } catch (err) {
        if (!isConnectionLost(err)) throw err;
        console.warn("IndexedDB の接続が切れていたので開き直します:", err);
        forget(promise);
        try {
            db.close();
        } catch {
            // 切れた接続なので閉じられなくてもよい
        }
        return run(await openDb());
    }
};

const wrap = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
    try {
        return await fn();
    } catch (err) {
        if (err instanceof RomStorageError) throw err;
        console.error(message, err);
        throw new RomStorageError(message, { cause: err });
    }
};

const sameBytes = (a: unknown, b: ArrayBuffer): boolean => {
    if (!(a instanceof ArrayBuffer) || a.byteLength !== b.byteLength) {
        return false;
    }
    const x = new Uint8Array(a);
    const y = new Uint8Array(b);
    for (let i = 0; i < x.length; i++) {
        if (x[i] !== y[i]) return false;
    }
    return true;
};


// ファイルを roms に保存し、lastRomId をそれにする。同じ中身の ROM がすでにあれば
// 保存し直さず（名前・登録日時も元のまま）、lastRomId だけ更新する。
export const importRom = (file: File): Promise<RomRecord> =>
    wrap("ROM を端末に保存できませんでした。", async () => {
        // GBA の ROM は 32MB まで、Game Boy の ROM は 8MB まで（GBA かは読んでから名前とヘッダで見る）
        if (file.size < MIN_ROM_SIZE || file.size > MAX_GBA_ROM_SIZE) {
            throw new RomStorageError(
                `「${file.name}」は Game Boy・GBA の ROM として大きさが合いません。`,
            );
        }
        const data = await file.arrayBuffer();
        if (
            file.size > MAX_GB_ROM_SIZE &&
            detectRomSystem(file.name, data) !== "gba"
        ) {
            throw new RomStorageError(
                `「${file.name}」は Game Boy の ROM として大きさが合いません。`,
            );
        }
        const id = await computeRomId(data);
        return withDb(async db => {
            const transaction = db.transaction(
                [ROMS_STORE, SETTINGS_STORE],
                "readwrite",
            );
            const done = transactionDone(transaction);
            const roms = transaction.objectStore(ROMS_STORE);
            const existing = await requestToPromise<RomRecord | undefined>(
                roms.get(id),
            );
            // 保存済みのデータが壊れていたら、選び直したファイルで直す（名前・登録日時は元のまま）。
            // ここで await すると（IndexedDB 以外を待つと）トランザクションが閉じるので、ハッシュではなく中身を比べる
            const intact =
                existing !== undefined && sameBytes(existing.data, data);
            const record: RomRecord = intact
                ? existing
                : {
                      id,
                      name: existing?.name ?? file.name,
                      data,
                      createdAt: existing?.createdAt ?? Date.now(),
                  };
            if (!intact) {
                roms.put(record);
            }
            transaction
                .objectStore(SETTINGS_STORE)
                .put({ key: LAST_ROM_ID_KEY, value: id } satisfies SettingRecord);
            await done;
            return record;
        });
    });

// 保存済みの ROM を読む。無い・中身が壊れている場合は RomStorageError。
export const loadRom = (id: string): Promise<RomRecord> =>
    wrap("保存した ROM を読み込めませんでした。", async () => {
        const record = await withDb(db =>
            requestToPromise<RomRecord | undefined>(
                db
                    .transaction(ROMS_STORE, "readonly")
                    .objectStore(ROMS_STORE)
                    .get(id),
            ),
        );
        if (!record) {
            throw new RomStorageError(
                "保存した ROM が見つかりません。ROM を選び直してください。",
            );
        }
        if (
            !(record.data instanceof ArrayBuffer) ||
            (await computeRomId(record.data)) !== id
        ) {
            throw new RomStorageError(
                `保存した ROM「${record.name}」のデータが壊れています。ROM を選び直してください。`,
            );
        }
        return record;
    });

// 一覧用。ROM 本体は返さない（登録順）。
export const listRoms = (): Promise<RomSummary[]> =>
    wrap("保存した ROM の一覧を読み込めませんでした。", async () => {
        const records = await withDb(db =>
            requestToPromise<RomRecord[]>(
                db
                    .transaction(ROMS_STORE, "readonly")
                    .objectStore(ROMS_STORE)
                    .getAll(),
            ),
        );
        return records
            .map(({ id, name, createdAt }) => ({ id, name, createdAt }))
            .sort((a, b) => a.createdAt - b.createdAt);
    });

export const getLastRomId = (): Promise<string | null> =>
    wrap("前回の ROM の記録を読み込めませんでした。", async () => {
        const setting = await withDb(db =>
            requestToPromise<SettingRecord | undefined>(
                db
                    .transaction(SETTINGS_STORE, "readonly")
                    .objectStore(SETTINGS_STORE)
                    .get(LAST_ROM_ID_KEY),
            ),
        );
        return typeof setting?.value === "string" ? setting.value : null;
    });

export const setLastRomId = (id: string): Promise<void> =>
    wrap("前回の ROM を記録できませんでした。", async () => {
        await withDb(db => {
            const transaction = db.transaction(SETTINGS_STORE, "readwrite");
            const done = transactionDone(transaction);
            transaction
                .objectStore(SETTINGS_STORE)
                .put({ key: LAST_ROM_ID_KEY, value: id } satisfies SettingRecord);
            return done;
        });
    });

// 枠に保存する（上書き）。トランザクションの完了まで待ち、保存した日時を返す
export const putSaveState = (
    romId: string,
    data: ArrayBuffer,
    screenshot?: ArrayBuffer,
): Promise<number> =>
    wrap("セーブできませんでした。", async () => {
        const savedAt = Date.now();
        try {
            await withDb(db => {
                const transaction = db.transaction(
                    SAVE_STATES_STORE,
                    "readwrite",
                );
                const done = transactionDone(transaction);
                transaction.objectStore(SAVE_STATES_STORE).put({
                    romId,
                    data,
                    savedAt,
                    ...(screenshot && { screenshot }),
                } satisfies SaveStateRecord);
                return done;
            });
        } catch (err) {
            if (err instanceof DOMException && err.name === "QuotaExceededError") {
                throw new RomStorageError(
                    "端末の保存領域が足りず、セーブできませんでした。",
                    { cause: err },
                );
            }
            throw err;
        }
        return savedAt;
    });

// 枠を読む。空なら null
export const getSaveState = (romId: string): Promise<SaveStateRecord | null> =>
    wrap("セーブを読み込めませんでした。", async () => {
        const record = await withDb(db =>
            requestToPromise<SaveStateRecord | undefined>(
                db
                    .transaction(SAVE_STATES_STORE, "readonly")
                    .objectStore(SAVE_STATES_STORE)
                    .get(romId),
            ),
        );
        if (!record) return null;
        if (!(record.data instanceof ArrayBuffer)) {
            throw new RomStorageError("セーブのデータが壊れています。");
        }
        // 画面の画像は無くてもロードできるので、おかしければ捨てるだけにする
        if (
            record.screenshot !== undefined &&
            !(record.screenshot instanceof ArrayBuffer)
        ) {
            return {
                romId: record.romId,
                data: record.data,
                savedAt: record.savedAt,
            };
        }
        return record;
    });
