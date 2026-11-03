// Wrapper around the phonemizer WASM (g2p.js + g2p_wasm.js + g2p_wasm.wasm in one folder).
import { rewriteEmphasis } from './preprocess.js';
export class PhonemizerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export class Phonemizer {
    g2p;
    errorClass;
    spaceId;
    constructor(g2p, errorClass) {
        this.g2p = g2p;
        this.errorClass = errorClass;
        const sp = g2p.phonemesToIds(' ');
        this.spaceId = Number(sp[1]);
    }
    /** `moduleUrl`: file: URL of g2p.js (its wasm is read from the same folder). */
    static async load(moduleUrl) {
        const mod = (await import(moduleUrl));
        const g2p = await mod.createG2P();
        return new Phonemizer(g2p, mod.G2PError);
    }
    /** Phonemes for one text: the old phonemize() = emphasis rewrite, then g2p, chunks joined with a space. */
    phonemize(text, letter) {
        if (!text)
            return '';
        try {
            const chunks = this.g2p.pipeline(rewriteEmphasis(text), letter);
            if (chunks.length === 1)
                return chunks[0].phonemes;
            let s = '';
            for (let i = 0; i < chunks.length; i++)
                s += (i ? ' ' : '') + chunks[i].phonemes;
            return s;
        }
        catch (e) {
            if (e instanceof this.errorClass)
                throw new PhonemizerError(e.code, e.message);
            throw e;
        }
    }
    /** Token ids for a phoneme string, without the BOS/EOS the wasm adds. */
    ids(phonemes) {
        if (!phonemes)
            return new Int32Array(0);
        const raw = this.g2p.phonemesToIds(phonemes);
        const out = new Int32Array(raw.length - 2);
        for (let i = 0; i < out.length; i++)
            out[i] = Number(raw[i + 1]);
        return out;
    }
    /** Number of phonemes the model will see (characters present in the vocabulary). */
    validCount(phonemes) {
        return phonemes ? this.g2p.phonemesToIds(phonemes).length - 2 : 0;
    }
    version() { return this.g2p.version(); }
}
