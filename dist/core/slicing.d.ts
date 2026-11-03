import type { InferenceItem } from './types.js';
export declare const SAMPLES_PER_FRAME = 600;
export declare const FADE_SAMPLES = 240;
export declare const PREFIX_SILENCE_SAMPLES = 3600;
/** Build the model input from the three id lists, exactly like tokenising prefix+" "+target+" "+suffix. */
export declare function joinIds(prefix: ArrayLike<number>, target: ArrayLike<number>, suffix: ArrayLike<number>, spaceId: number): Int32Array;
/**
 * Token ids that carry a pause rather than speech: punctuation and the space
 * (; : , . ! ? — … " ( ) “ ” and " " in the model's vocabulary).
 */
export declare const NON_SPEECH_IDS: ReadonlySet<number>;
/** Analysis window for finding the quiet point between two parts (5 ms). */
export declare const QUIET_WINDOW = 120;
/** A window counts as quiet when its power is within this many dB of the quietest window. */
export declare const QUIET_DB = 6;
/**
 * Where the speech after a pause begins: the end of the last quiet window in [from, to).
 * The model starts sounding a word 25-60 ms before its predicted duration says it starts, so
 * duration boundaries alone land inside the next word's onset; the audio decides instead.
 * Every sample before the returned point is part of the pause or of the speech before it.
 */
export declare function quietPoint(audio: Float32Array, from: number, to: number): number;
export interface SliceBounds {
    /** First sample of the full output that goes into the segment. */
    startSample: number;
    /** One past the last sample of the full output that goes into the segment. */
    endSample: number;
    /** Leading samples of the segment that are silence (the pause before a part that follows another). */
    silence: number;
    /** Samples of the segment after which only silence follows (the next part's onset is removed). */
    speechEnd: number;
}
type SliceItem = Pick<InferenceItem, 'ids' | 'prefixLen' | 'targetLen' | 'hasPrefix' | 'hasSuffix'>;
/**
 * Bounds of the target inside the full output (prefix + " " + target + " " + suffix).
 * `durations` has one entry per token including BOS (index 0) and EOS (last), so the token
 * ids[k-1] is durations[k]. The segment keeps the target's own time: it starts 150 ms before
 * the space that precedes the target and ends where the target's last token ends. Inside that
 * span, the speech of the neighbouring parts is cut at the quiet point between them.
 */
export declare function sliceBounds(durations: Int32Array, audio: Float32Array, item: SliceItem): SliceBounds;
/** Apply the whole post-model step for one item and return a new Float32Array. */
export declare function sliceAndShape(audio: Float32Array, durations: Int32Array, item: Pick<InferenceItem, 'ids' | 'prefixLen' | 'targetLen' | 'hasPrefix' | 'hasSuffix' | 'gainDb'>): Float32Array;
export declare function concatAudio(parts: Float32Array[]): Float32Array;
export {};
