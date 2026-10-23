// 設計書 7 章: 保存領域の永続化を頼み、使用量と上限を確かめる。
// persist() が true でも、ユーザーによる削除や端末の故障からは守られない。
export interface StorageStatus {
    readonly persisted: boolean | null; // null = この環境では使えない
    readonly usageMB: number | null;
    readonly quotaMB: number | null;
}

const toMB = (bytes: number | undefined): number | null =>
    bytes === undefined ? null : Math.round((bytes / 1024 / 1024) * 10) / 10;

export const requestPersistentStorage = async (): Promise<StorageStatus> => {
    const storage = navigator.storage as StorageManager | undefined;
    let persisted: boolean | null = null;
    let usageMB: number | null = null;
    let quotaMB: number | null = null;
    try {
        if (storage?.persist) {
            persisted = await storage.persist();
        }
    } catch (err) {
        console.warn("navigator.storage.persist() に失敗しました:", err);
    }
    try {
        if (storage?.estimate) {
            const { usage, quota } = await storage.estimate();
            usageMB = toMB(usage);
            quotaMB = toMB(quota);
        }
    } catch (err) {
        console.warn("navigator.storage.estimate() に失敗しました:", err);
    }
    const status = { persisted, usageMB, quotaMB };
    console.info("storage:", status);
    return status;
};
