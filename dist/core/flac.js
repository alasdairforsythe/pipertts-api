// 24-bit FLAC encoding through libflacjs (Emscripten build of libFLAC). Samples are float32 in [-1, 1]; values outside are hard
// clipped and counted.
import { createRequire } from 'node:module';
import { SAMPLE_RATE } from './types.js';
export const FLAC_BITS = 24;
export const FLAC_COMPRESSION = 5;
const FULL = 8388607; // 2^23 - 1
let libPromise = null;
/**
 * Load libflacjs from node_modules. The Emscripten build reads its wasm from disk only when
 * there is no global fetch, so fetch is hidden while the module initialises.
 */
export function loadFlac() {
    if (libPromise)
        return libPromise;
    libPromise = (async () => {
        const g = globalThis;
        const f = g.fetch;
        g.fetch = undefined;
        let lib;
        try {
            lib = createRequire(import.meta.url)('libflacjs/dist/libflac.wasm.js');
        }
        finally {
            g.fetch = f;
        }
        if (!lib.isReady())
            await new Promise((r) => lib.on('ready', () => r()));
        return lib;
    })();
    return libPromise;
}
/** Quantise float32 to 24-bit integers in place into `out`; returns the number of clipped samples. */
export function quantise24(samples, out) {
    let clipped = 0;
    for (let i = 0; i < samples.length; i++) {
        const x = samples[i] * FULL;
        if (x > FULL) {
            out[i] = FULL;
            clipped++;
        }
        else if (x < -FULL - 1) {
            out[i] = -FULL - 1;
            clipped++;
        }
        else
            out[i] = Math.round(x);
    }
    return clipped;
}
export class FlacEncoder {
    lib;
    scratch = new Int32Array(0);
    constructor(lib) {
        this.lib = lib;
    }
    static async create() {
        return new FlacEncoder(await loadFlac());
    }
    encode(samples, sampleRate = SAMPLE_RATE) {
        const lib = this.lib;
        if (this.scratch.length < samples.length)
            this.scratch = new Int32Array(samples.length);
        const pcm = this.scratch.subarray(0, samples.length);
        const clipped = quantise24(samples, pcm);
        const enc = lib.create_libflac_encoder(sampleRate, 1, FLAC_BITS, FLAC_COMPRESSION, samples.length, false, 0);
        if (!enc)
            throw new Error('FLAC encoder could not be created');
        const chunks = [];
        let total = 0;
        const status = lib.init_encoder_stream(enc, (data) => {
            chunks.push(data.slice()); // the view may point into wasm memory
            total += data.length;
        });
        if (status !== 0) {
            lib.FLAC__stream_encoder_delete(enc);
            throw new Error(`FLAC encoder init failed (${status})`);
        }
        const ok = lib.FLAC__stream_encoder_process_interleaved(enc, pcm, samples.length);
        const finished = lib.FLAC__stream_encoder_finish(enc);
        lib.FLAC__stream_encoder_delete(enc);
        if (!ok || !finished)
            throw new Error('FLAC encoding failed');
        const bytes = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
            bytes.set(c, off);
            off += c.length;
        }
        return { bytes, clipped, samples: samples.length };
    }
}
/** Decode a FLAC stream to float32 (first channel). Used by the tests. */
export async function decodeFlac(bytes) {
    const lib = await loadFlac();
    const dec = lib.create_libflac_decoder(false);
    if (!dec)
        throw new Error('FLAC decoder could not be created');
    let pos = 0;
    const out = [];
    let sampleRate = 0, bits = 0, decodeError = null;
    const status = lib.init_decoder_stream(dec, (n) => {
        const end = Math.min(pos + n, bytes.length);
        const buf = bytes.subarray(pos, end);
        const len = end - pos;
        pos = end;
        return { buffer: buf, readDataLength: len, error: false };
    }, (data, frameInfo) => {
        // libflacjs hands each channel as little-endian int32 samples
        const ch0 = data[0];
        const n = frameInfo.blocksize || ch0.length >> 2;
        const src = new Int32Array(ch0.buffer.slice(ch0.byteOffset, ch0.byteOffset + n * 4));
        out.push(src);
    }, (e) => { decodeError = e; }, (m) => { const mm = m; sampleRate = mm.sampleRate; bits = mm.bitsPerSample; });
    if (status !== 0) {
        lib.FLAC__stream_decoder_delete(dec);
        throw new Error(`FLAC decoder init failed (${status})`);
    }
    const ok = lib.FLAC__stream_decoder_process_until_end_of_stream(dec);
    lib.FLAC__stream_decoder_finish(dec);
    lib.FLAC__stream_decoder_delete(dec);
    if (!ok || decodeError)
        throw new Error('FLAC decoding failed: ' + String(decodeError));
    const total = out.reduce((s, b) => s + b.length, 0);
    const samples = new Float32Array(total);
    const scale = 1 / 2 ** (bits - 1);
    let off = 0;
    for (const b of out) {
        for (let i = 0; i < b.length; i++)
            samples[off + i] = b[i] * scale;
        off += b.length;
    }
    return { samples, sampleRate, bits };
}
