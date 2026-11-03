// Voice styles and gains: port of load_voice / blend_voices / make_voice (tts_single.py
// 624-697) over raw float32 voice files (510 rows x 256).

import type { FilterId, LangId } from './types.js';

export interface VoiceInfo { file: string; name: string; accent: string; gender: 'f' | 'm'; listed: boolean }
export interface VoiceManifest {
  voices: Record<string, VoiceInfo>;
  groups: { name: string; voices: { name: string; id: number }[] }[];
}
export type GainTable = Record<string, number[]>;

export const ROWS = 510, DIM = 256;

/** Reads one voice file (`VoiceInfo.file`) and returns its bytes. */
export type VoiceFileLoader = (file: string) => Promise<ArrayBuffer>;

/** default voice per book language (tts_single.py DEFAULT_VOICE), Japanese removed */
export const DEFAULT_VOICE: Record<LangId, number[]> = { 0: [50], 1: [70], 2: [10], 3: [74], 4: [29], 5: [75], 6: [73] };
/** [female base, male base, base weight, original weight] (tts_single.py LANGUAGE_MAP) */
export const BLEND: Record<Exclude<LangId, 0>, [number, number, number, number]> = {
  1: [70, 95, 1.0, 0.7],
  2: [97, 96, 0.7, 1.0],
  3: [71, 74, 1.0, 1.0],
  4: [99, 98, 1.0, 1.0],
  5: [72, 90, 1.0, 0.9],
  6: [91, 92, 1.0, 1.0],
};

export interface VoiceResult { style: Float32Array; gainDb: number }

export class VoiceBank {
  private data = new Map<number, Float32Array>();
  private loading = new Map<number, Promise<Float32Array>>();

  constructor(readonly manifest: VoiceManifest, readonly gains: GainTable, private loadFile: VoiceFileLoader) {}

  isMale(id: number): boolean {
    const v = this.manifest.voices[id];
    if (!v) throw new Error(`unknown voice ${id}`);
    return v.gender === 'm';
  }
  isBritish(id: number): boolean {
    const v = this.manifest.voices[id];
    return !!v && v.accent === 'b';
  }

  gain(id: number, filter: FilterId): number {
    const g = this.gains[id];
    if (!g) throw new Error(`no gains for voice ${id}`);
    return g[filter];
  }

  /** Full 510x256 tensor of one voice (loaded once). */
  voice(id: number): Promise<Float32Array> {
    const have = this.data.get(id);
    if (have) return Promise.resolve(have);
    let p = this.loading.get(id);
    if (!p) {
      const info = this.manifest.voices[id];
      if (!info) return Promise.reject(new Error(`unknown voice ${id}`));
      p = this.loadFile(info.file)
        .then((b) => {
          if (b.byteLength !== ROWS * DIM * 4) throw new Error(`voice ${id}: bad size ${b.byteLength}`);
          const f = new Float32Array(b);
          this.data.set(id, f);
          return f;
        })
        // success or failure, the next caller starts from `data` or from a fresh load:
        // a rejected promise left here would make this voice fail for the rest of the session
        .finally(() => { this.loading.delete(id); });
      this.loading.set(id, p);
    }
    return p;
  }

  /** Provide a voice tensor directly (tests, or a caller that already has the bytes). */
  preload(id: number, data: Float32Array): void { this.data.set(id, data); }

  async prefetch(ids: Iterable<number>): Promise<void> {
    await Promise.all(Array.from(ids, (id) => this.voice(id)));
  }

  /** make_voice(): the style row for `sliceIndex` and the gain in dB. */
  async makeVoice(voiceIds: number[], sliceIndex: number, bookLang: LangId, filter: FilterId): Promise<VoiceResult> {
    const row = Math.min(Math.max(sliceIndex, 0), ROWS - 1);
    let ids = voiceIds;
    if (ids.length === 0) ids = DEFAULT_VOICE[bookLang];
    const needed = new Set(ids);
    let blend: [number, number, number, number] | undefined;
    if (bookLang !== 0) {
      blend = BLEND[bookLang as Exclude<LangId, 0>];
      needed.add(blend[0]); needed.add(blend[1]);
    }
    await this.prefetch(needed);

    // average of the selected voices (torch.mean over the stack) and of their gains
    const style = new Float32Array(DIM);
    let gain = 0, male = 0;
    for (const id of ids) {
      const v = this.data.get(id)!;
      const off = row * DIM;
      for (let i = 0; i < DIM; i++) style[i] += v[off + i];
      gain += this.gain(id, filter);
      if (this.isMale(id)) male++;
    }
    if (ids.length > 1) {
      const inv = 1 / ids.length;
      for (let i = 0; i < DIM; i++) style[i] = Math.fround(style[i] * inv);
      gain /= ids.length;
    }
    if (!blend) return { style, gainDb: gain };

    const [femaleId, maleId, foreignW, originalW] = blend;
    let foreign: Float32Array, foreignGain: number;
    const off = row * DIM;
    if (male === ids.length) {
      foreign = this.data.get(maleId)!.subarray(off, off + DIM);
      foreignGain = this.gain(maleId, filter);
    } else if (male === 0) {
      foreign = this.data.get(femaleId)!.subarray(off, off + DIM);
      foreignGain = this.gain(femaleId, filter);
    } else {
      const mw = male / ids.length, fw = 1 - mw;
      const m = this.data.get(maleId)!, f = this.data.get(femaleId)!;
      const r = blendVoices(m.subarray(off, off + DIM), mw, this.gain(maleId, filter), f.subarray(off, off + DIM), fw, this.gain(femaleId, filter));
      foreign = r.style; foreignGain = r.gainDb;
    }
    return blendVoices(foreign, foreignW, foreignGain, style, originalW, gain);
  }
}

/** blend_voices(): weighted average of two rows and two gains with normalised weights. */
export function blendVoices(a: Float32Array, wa: number, ga: number, b: Float32Array, wb: number, gb: number): VoiceResult {
  const total = wa + wb;
  const w1 = total === 0 ? 0.5 : wa / total, w2 = total === 0 ? 0.5 : wb / total;
  const style = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) style[i] = Math.fround(Math.fround(a[i] * w1) + Math.fround(b[i] * w2));
  return { style, gainDb: ga * w1 + gb * w2 };
}
