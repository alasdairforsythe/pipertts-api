import { type Log } from './assets.js';
import { type LangId } from './core/types.js';
/** Book languages: drive phonemization and the accent blend. */
export declare const LANGUAGES: Readonly<Record<string, LangId>>;
export declare const SPEED_MIN = 0.5, SPEED_MAX = 2;
export interface Voice {
    name: string;
    id: number;
    accent: 'American' | 'British';
    gender: 'female' | 'male';
    group: string;
}
/** A cast entry: a voice ("Clara", "Clara+Sophia") or a voice with its own speed. */
export type CastEntry = string | {
    voice?: string;
    speed?: number;
};
/** Character name -> voice. "Narrator" is the text outside any [Name] tag. */
export type Cast = Record<string, CastEntry>;
export interface SpeakOptions {
    /** Plain text, or a script with [Name] tags, blank lines, `_` pauses and ((context)). */
    text: string;
    /** Narrator voice: a name, an id, or several joined with "+" to blend them. */
    voice?: string;
    /** 0.5 to 2.0, default 1.0. Applies to every character without its own speed. */
    speed?: number;
    /** en, fr, es, it, pt, hi or zh. Default en. */
    language?: string;
    /** Voices for the [Name] characters in the text. */
    cast?: Cast;
    /** Called after each spoken segment. */
    onProgress?: (done: number, total: number) => void;
}
export interface SpeakResult {
    /** The whole text as one FLAC file: 24 kHz, mono, 24-bit. */
    flac: Uint8Array;
    seconds: number;
    /** Number of spoken segments. */
    segments: number;
    warnings: string[];
}
export interface LoadOptions {
    /** CPU threads for the model (default: number of cores, at most 8). */
    threads?: number;
    /** Progress lines (downloads). Default: none. */
    log?: Log;
}
export declare class PiperTTS {
    private session;
    private phonemizer;
    private bank;
    private encoder;
    readonly threads: number;
    /** Requests run one at a time on the single model session. */
    private queue;
    private constructor();
    /** Download what is missing (first run only) and load the model. */
    static load(opts?: LoadOptions): Promise<PiperTTS>;
    /**
     * Download or refresh everything, including every voice, so later runs work offline.
     * Returns the cache folder's voice count.
     */
    static download(log: Log): Promise<number>;
    /** The voices that can be used by name, grouped as in the web app. */
    voices(): Voice[];
    /** "Clara", "clara", "Gabriel", "12" or "Clara+Sophia" -> voice ids. */
    resolveVoice(spec: string): number[];
    /** Speak `text` and return one FLAC file. Calls are queued; one runs at a time. */
    speak(opts: SpeakOptions): Promise<SpeakResult>;
    private run;
    /** One text segment through the model; null when it has nothing to say. */
    private segment;
    /** Cast + narrator voice + speed -> the web app's character settings (speeds x100). */
    private characters;
    /** Name of the voice used when no voice is given, per language. */
    static defaultVoice(language?: string): string;
}
/** A problem with the request (bad voice, speed, language, empty text), not with the engine. */
export declare class UsageError extends Error {
    constructor(message: string);
}
