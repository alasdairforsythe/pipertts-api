// Sanity checks on what comes back from the model, so a broken run (NaN, a truncated
// buffer, a stale session after a wasm fault) raises an error instead of being encoded
// and kept in the segment cache for good. Pure functions; run inside the inference worker.

import { SAMPLES_PER_FRAME } from './slicing.js';

export class ModelOutputError extends Error {
  constructor(message: string) { super(`model output invalid: ${message}`); this.name = 'ModelOutputError'; }
}

/**
 * The exported graph promises `durations` has one entry per token plus BOS and EOS and
 * `audio.length === sum(durations) * 600` (build_model.py). Anything else means the run
 * did not go through the model as built.
 */
export function checkModelOutput(audio: ArrayLike<number>, durations: ArrayLike<number>, tokenCount: number): void {
  if (durations.length !== tokenCount + 2) throw new ModelOutputError(`${durations.length} durations for ${tokenCount} tokens`);
  let frames = 0;
  for (let i = 0; i < durations.length; i++) {
    const d = durations[i];
    if (!(d >= 0) || d !== Math.floor(d)) throw new ModelOutputError(`duration[${i}] = ${d}`);
    frames += d;
  }
  if (frames === 0) throw new ModelOutputError('zero total duration');
  if (audio.length !== frames * SAMPLES_PER_FRAME) throw new ModelOutputError(`${audio.length} samples for ${frames} frames`);
  for (let i = 0; i < audio.length; i++) {
    if (!Number.isFinite(audio[i])) throw new ModelOutputError(`non-finite sample at ${i}`);
  }
}

/** The sliced, shaped segment that is about to be encoded: it must contain some signal. */
export function checkSegmentAudio(audio: ArrayLike<number>): void {
  if (audio.length === 0) throw new ModelOutputError('empty segment');
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    const a = Math.abs(audio[i]);
    if (a > peak) peak = a;
  }
  if (!(peak > 1e-6)) throw new ModelOutputError('segment is digital silence');
}
