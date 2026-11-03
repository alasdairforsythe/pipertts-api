export declare class ModelOutputError extends Error {
    constructor(message: string);
}
/**
 * The exported graph promises `durations` has one entry per token plus BOS and EOS and
 * `audio.length === sum(durations) * 600` (build_model.py). Anything else means the run
 * did not go through the model as built.
 */
export declare function checkModelOutput(audio: ArrayLike<number>, durations: ArrayLike<number>, tokenCount: number): void;
/** The sliced, shaped segment that is about to be encoded: it must contain some signal. */
export declare function checkSegmentAudio(audio: ArrayLike<number>): void;
