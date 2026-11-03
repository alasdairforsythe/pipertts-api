// Wrapper around the phonemizer WASM (g2p.js + g2p_wasm.js + g2p_wasm.wasm in one folder).

import type { LangLetter } from './types.js';
import { rewriteEmphasis } from './preprocess.js';

export interface G2PChunk { graphemes: string; phonemes: string; textIndex: number }
export interface G2P {
  pipeline(text: string, lang: LangLetter): G2PChunk[];
  phonemesToIds(phonemes: string): BigInt64Array;
  version(): string;
}
export interface G2PModule {
  createG2P(opts?: Record<string, unknown>): Promise<G2P>;
  G2PError: new (...a: unknown[]) => Error & { code: string };
}

export class PhonemizerError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export class Phonemizer {
  readonly spaceId: number;
  private constructor(private g2p: G2P, private errorClass: G2PModule['G2PError']) {
    const sp = g2p.phonemesToIds(' ');
    this.spaceId = Number(sp[1]);
  }

  /** `moduleUrl`: file: URL of g2p.js (its wasm is read from the same folder). */
  static async load(moduleUrl: string): Promise<Phonemizer> {
    const mod = (await import(moduleUrl)) as G2PModule;
    const g2p = await mod.createG2P();
    return new Phonemizer(g2p, mod.G2PError);
  }

  /** Phonemes for one text: the old phonemize() = emphasis rewrite, then g2p, chunks joined with a space. */
  phonemize(text: string, letter: LangLetter): string {
    if (!text) return '';
    try {
      const chunks = this.g2p.pipeline(rewriteEmphasis(text), letter);
      if (chunks.length === 1) return chunks[0].phonemes;
      let s = '';
      for (let i = 0; i < chunks.length; i++) s += (i ? ' ' : '') + chunks[i].phonemes;
      return s;
    } catch (e) {
      if (e instanceof this.errorClass) throw new PhonemizerError(e.code, e.message);
      throw e;
    }
  }

  /** Token ids for a phoneme string, without the BOS/EOS the wasm adds. */
  ids(phonemes: string): Int32Array {
    if (!phonemes) return new Int32Array(0);
    const raw = this.g2p.phonemesToIds(phonemes);
    const out = new Int32Array(raw.length - 2);
    for (let i = 0; i < out.length; i++) out[i] = Number(raw[i + 1]);
    return out;
  }

  /** Number of phonemes the model will see (characters present in the vocabulary). */
  validCount(phonemes: string): number {
    return phonemes ? this.g2p.phonemesToIds(phonemes).length - 2 : 0;
  }

  version(): string { return this.g2p.version(); }
}
