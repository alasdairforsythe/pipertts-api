export declare const FLAC_BITS = 24;
export declare const FLAC_COMPRESSION = 5;
export interface FlacResult {
    bytes: Uint8Array;
    clipped: number;
    samples: number;
}
interface FlacLib {
    isReady(): boolean;
    on(ev: 'ready', cb: () => void): void;
    create_libflac_encoder(sr: number, ch: number, bps: number, level: number, total: number, verify: boolean, block: number): number;
    init_encoder_stream(enc: number, write: (data: Uint8Array, bytes: number, samples: number, frame: number) => void, meta?: (m: unknown) => void): number;
    FLAC__stream_encoder_process_interleaved(enc: number, buf: Int32Array, n: number): boolean;
    FLAC__stream_encoder_finish(enc: number): boolean;
    FLAC__stream_encoder_delete(enc: number): void;
    FLAC__stream_encoder_get_state(enc: number): number;
    create_libflac_decoder(verify: boolean): number;
    init_decoder_stream(dec: number, read: (n: number) => {
        buffer: Uint8Array;
        readDataLength: number;
        error: boolean;
    }, write: (data: Uint8Array[], frameInfo: unknown) => void, error: (e: unknown) => void, meta?: (m: unknown) => void, ogg?: boolean): number;
    FLAC__stream_decoder_process_until_end_of_stream(dec: number): boolean;
    FLAC__stream_decoder_finish(dec: number): boolean;
    FLAC__stream_decoder_delete(dec: number): void;
}
/**
 * Load libflacjs from node_modules. The Emscripten build reads its wasm from disk only when
 * there is no global fetch, so fetch is hidden while the module initialises.
 */
export declare function loadFlac(): Promise<FlacLib>;
/** Quantise float32 to 24-bit integers in place into `out`; returns the number of clipped samples. */
export declare function quantise24(samples: Float32Array, out: Int32Array): number;
export declare class FlacEncoder {
    private lib;
    private scratch;
    constructor(lib: FlacLib);
    static create(): Promise<FlacEncoder>;
    encode(samples: Float32Array, sampleRate?: number): FlacResult;
}
/** Decode a FLAC stream to float32 (first channel). Used by the tests. */
export declare function decodeFlac(bytes: Uint8Array): Promise<{
    samples: Float32Array;
    sampleRate: number;
    bits: number;
}>;
export {};
