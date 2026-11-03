// Context slicing after inference (tts_single.py 235-357): cut the target out of
// prefix + target + suffix using the model's durations and the quiet points in the audio,
// with the 150 ms pause before a part that follows another, fades and the gain.
// Pure functions over typed arrays; runs inside the inference worker.

import type { InferenceItem } from './types.js';

export const SAMPLES_PER_FRAME = 600;
export const FADE_SAMPLES = 240; // 10 ms at 24 kHz
export const PREFIX_SILENCE_SAMPLES = 3600; // 150 ms

/** Build the model input from the three id lists, exactly like tokenising prefix+" "+target+" "+suffix. */
export function joinIds(prefix: ArrayLike<number>, target: ArrayLike<number>, suffix: ArrayLike<number>, spaceId: number): Int32Array {
  const n = prefix.length + (prefix.length ? 1 : 0) + target.length + (suffix.length ? 1 : 0) + suffix.length;
  const out = new Int32Array(n);
  let p = 0;
  for (let i = 0; i < prefix.length; i++) out[p++] = prefix[i];
  if (prefix.length) out[p++] = spaceId;
  for (let i = 0; i < target.length; i++) out[p++] = target[i];
  if (suffix.length) out[p++] = spaceId;
  for (let i = 0; i < suffix.length; i++) out[p++] = suffix[i];
  return out;
}

function sumFrames(d: Int32Array, end: number): number {
  let s = 0;
  const n = Math.min(end, d.length);
  for (let i = 0; i < n; i++) s += d[i];
  return s;
}

/**
 * Token ids that carry a pause rather than speech: punctuation and the space
 * (; : , . ! ? — … " ( ) “ ” and " " in the model's vocabulary).
 */
export const NON_SPEECH_IDS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16]);

/** Analysis window for finding the quiet point between two parts (5 ms). */
export const QUIET_WINDOW = 120;
/** A window counts as quiet when its power is within this many dB of the quietest window. */
export const QUIET_DB = 6;

/**
 * Where the speech after a pause begins: the end of the last quiet window in [from, to).
 * The model starts sounding a word 25-60 ms before its predicted duration says it starts, so
 * duration boundaries alone land inside the next word's onset; the audio decides instead.
 * Every sample before the returned point is part of the pause or of the speech before it.
 */
export function quietPoint(audio: Float32Array, from: number, to: number): number {
  from = Math.max(0, from);
  to = Math.min(audio.length, to);
  const n = Math.floor((to - from) / QUIET_WINDOW);
  if (n <= 0) return Math.max(from, Math.min(to, audio.length));
  const power = new Float64Array(n);
  let min = Infinity;
  for (let w = 0; w < n; w++) {
    let e = 0;
    const a = from + w * QUIET_WINDOW;
    for (let i = a; i < a + QUIET_WINDOW; i++) e += audio[i] * audio[i];
    power[w] = e;
    if (e < min) min = e;
  }
  const limit = min * Math.pow(10, QUIET_DB / 10) + 1e-12;
  let last = 0;
  for (let w = 0; w < n; w++) if (power[w] <= limit) last = w;
  return from + (last + 1) * QUIET_WINDOW;
}

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

const isSpeech = (item: SliceItem, k: number) => !NON_SPEECH_IDS.has(item.ids[k - 1]);

/**
 * Bounds of the target inside the full output (prefix + " " + target + " " + suffix).
 * `durations` has one entry per token including BOS (index 0) and EOS (last), so the token
 * ids[k-1] is durations[k]. The segment keeps the target's own time: it starts 150 ms before
 * the space that precedes the target and ends where the target's last token ends. Inside that
 * span, the speech of the neighbouring parts is cut at the quiet point between them.
 */
export function sliceBounds(durations: Int32Array, audio: Float32Array, item: SliceItem): SliceBounds {
  const P = item.prefixLen, T = item.targetLen;
  const lead = item.hasPrefix ? 1 : 0;
  const spf = SAMPLES_PER_FRAME;
  const first = P + lead + 1, last = P + lead + T; // target tokens in `durations`
  const at = (k: number) => Math.min(sumFrames(durations, k) * spf, audio.length); // start of token k

  let endSample = audio.length, speechEndAbs = audio.length;
  if (item.hasSuffix) {
    let lastSpoken = last;
    while (lastSpoken >= first && !isSpeech(item, lastSpoken)) lastSpoken--;
    if (lastSpoken < first) lastSpoken = first;
    let nextSpoken = last + 1;
    const n = item.ids.length;
    while (nextSpoken <= n && !isSpeech(item, nextSpoken)) nextSpoken++;
    speechEndAbs = quietPoint(audio, at(lastSpoken + 1), at(nextSpoken));
    endSample = Math.max(at(last + 1), speechEndAbs);
  }

  let startSample = 0, silence = 0;
  if (item.hasPrefix) {
    let prevSpoken = P;
    while (prevSpoken >= 1 && !isSpeech(item, prevSpoken)) prevSpoken--;
    let firstSpoken = first;
    while (firstSpoken < last && !isSpeech(item, firstSpoken)) firstSpoken++;
    const onset = quietPoint(audio, at(prevSpoken + 1), at(firstSpoken));
    const fadeFrom = Math.max(0, onset - FADE_SAMPLES);
    startSample = Math.max(0, Math.min(at(P + 1) - PREFIX_SILENCE_SAMPLES, fadeFrom));
    silence = fadeFrom - startSample;
  }
  return { startSample, endSample, silence, speechEnd: Math.max(0, speechEndAbs - startSample) };
}

function linspaceMul(buf: Float32Array, from: number, len: number, a: number, b: number): void {
  // multiply buf[from..from+len) by np.linspace(a, b, len, dtype=float32):
  // numpy computes i*step + start in float64, casts to float32 and forces the last value to `stop`
  if (len <= 0) return;
  if (len === 1) { buf[from] *= Math.fround(a); return; }
  const step = (b - a) / (len - 1);
  const last = len - 1;
  for (let i = 0; i < last; i++) buf[from + i] *= Math.fround(i * step + a);
  buf[from + last] *= Math.fround(b);
}

/** Apply the whole post-model step for one item and return a new Float32Array. */
export function sliceAndShape(
  audio: Float32Array,
  durations: Int32Array,
  item: Pick<InferenceItem, 'ids' | 'prefixLen' | 'targetLen' | 'hasPrefix' | 'hasSuffix' | 'gainDb'>,
): Float32Array {
  const gain = Math.pow(10, item.gainDb / 20);
  if (!item.hasPrefix && !item.hasSuffix) {
    const out = audio.slice();
    const f = Math.min(FADE_SAMPLES / 2, out.length);
    linspaceMul(out, 0, f, 0, 1);
    linspaceMul(out, out.length - f, f, 1, 0);
    if (gain !== 1) for (let i = 0; i < out.length; i++) out[i] *= gain;
    return out;
  }
  const { startSample, endSample, silence, speechEnd } = sliceBounds(durations, audio, item);
  const out = audio.slice(startSample, Math.max(startSample, endSample));
  if (silence > 0) out.fill(0, 0, Math.min(silence, out.length));
  const fadeIn = Math.min(FADE_SAMPLES, out.length - silence);
  if (fadeIn > 0) linspaceMul(out, silence, fadeIn, 0, 1);
  // the fade ends at the quiet point; everything after it is the next part's onset
  const keep = Math.min(speechEnd, out.length);
  const fadeOut = Math.min(FADE_SAMPLES, keep - Math.min(silence, keep));
  if (fadeOut > 0) linspaceMul(out, keep - fadeOut, fadeOut, 1, 0);
  out.fill(0, keep);
  if (gain !== 1) for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

export function concatAudio(parts: Float32Array[]): Float32Array {
  if (parts.length === 1) return parts[0];
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
