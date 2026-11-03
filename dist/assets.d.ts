export declare const MODEL_BASE_URL = "https://huggingface.co/alasdairforsythe/pipertts/resolve/main/";
export declare const MODEL_ID = "fp16";
export type Log = (line: string) => void;
/** Where downloads are kept: PIPERTTS_CACHE, else the platform's cache folder. */
export declare function cacheDir(): string;
export interface AssetPaths {
    modelPath: string;
    /** file: URL of g2p.js */
    g2pUrl: string;
    voicesDir: string;
}
/**
 * Make sure the model, the phonemizer and the voice lists are in the cache folder, downloading
 * what is missing. With `refresh`, everything is checked against the servers again and changed
 * files are replaced (the `download` command).
 */
export declare function ensureAssets(log: Log, refresh?: boolean): Promise<AssetPaths>;
/** Bytes of one voice file, downloaded the first time it is needed. */
export declare function voiceFile(voicesDir: string, file: string, log: Log, refresh?: boolean): Promise<ArrayBuffer>;
