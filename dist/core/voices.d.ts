import type { FilterId, LangId } from './types.js';
export interface VoiceInfo {
    file: string;
    name: string;
    accent: string;
    gender: 'f' | 'm';
    listed: boolean;
}
export interface VoiceManifest {
    voices: Record<string, VoiceInfo>;
    groups: {
        name: string;
        voices: {
            name: string;
            id: number;
        }[];
    }[];
}
export type GainTable = Record<string, number[]>;
export declare const ROWS = 510, DIM = 256;
/** Reads one voice file (`VoiceInfo.file`) and returns its bytes. */
export type VoiceFileLoader = (file: string) => Promise<ArrayBuffer>;
/** default voice per book language (tts_single.py DEFAULT_VOICE), Japanese removed */
export declare const DEFAULT_VOICE: Record<LangId, number[]>;
/** [female base, male base, base weight, original weight] (tts_single.py LANGUAGE_MAP) */
export declare const BLEND: Record<Exclude<LangId, 0>, [number, number, number, number]>;
export interface VoiceResult {
    style: Float32Array;
    gainDb: number;
}
export declare class VoiceBank {
    readonly manifest: VoiceManifest;
    readonly gains: GainTable;
    private loadFile;
    private data;
    private loading;
    constructor(manifest: VoiceManifest, gains: GainTable, loadFile: VoiceFileLoader);
    isMale(id: number): boolean;
    isBritish(id: number): boolean;
    gain(id: number, filter: FilterId): number;
    /** Full 510x256 tensor of one voice (loaded once). */
    voice(id: number): Promise<Float32Array>;
    /** Provide a voice tensor directly (tests, or a caller that already has the bytes). */
    preload(id: number, data: Float32Array): void;
    prefetch(ids: Iterable<number>): Promise<void>;
    /** make_voice(): the style row for `sliceIndex` and the gain in dB. */
    makeVoice(voiceIds: number[], sliceIndex: number, bookLang: LangId, filter: FilterId): Promise<VoiceResult>;
}
/** blend_voices(): weighted average of two rows and two gains with normalised weights. */
export declare function blendVoices(a: Float32Array, wa: number, ga: number, b: Float32Array, wb: number, gb: number): VoiceResult;
