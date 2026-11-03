import type { LangLetter } from './types.js';
export interface G2PChunk {
    graphemes: string;
    phonemes: string;
    textIndex: number;
}
export interface G2P {
    pipeline(text: string, lang: LangLetter): G2PChunk[];
    phonemesToIds(phonemes: string): BigInt64Array;
    version(): string;
}
export interface G2PModule {
    createG2P(opts?: Record<string, unknown>): Promise<G2P>;
    G2PError: new (...a: unknown[]) => Error & {
        code: string;
    };
}
export declare class PhonemizerError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export declare class Phonemizer {
    private g2p;
    private errorClass;
    readonly spaceId: number;
    private constructor();
    /** `moduleUrl`: file: URL of g2p.js (its wasm is read from the same folder). */
    static load(moduleUrl: string): Promise<Phonemizer>;
    /** Phonemes for one text: the old phonemize() = emphasis rewrite, then g2p, chunks joined with a space. */
    phonemize(text: string, letter: LangLetter): string;
    /** Token ids for a phoneme string, without the BOS/EOS the wasm adds. */
    ids(phonemes: string): Int32Array;
    /** Number of phonemes the model will see (characters present in the vocabulary). */
    validCount(phonemes: string): number;
    version(): string;
}
