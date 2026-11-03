import type { LangId, LangLetter } from './types.js';
/** `str.maketrans` table: value `null` means "delete this character". */
export declare const TRANS_TABLE: Readonly<Record<string, string | null>>;
export declare const CLOSERS = ")]}\"'\u2019\u201E\u201D\u201C\u00BB\u300F\u300D\u3011\uFF09";
export declare const QUESTION_EXCLAMATION: readonly string[];
export declare const PUNCTUATION_TO_REPLACE: readonly string[];
/** Voice id -> voice file name without the `.pt` extension (VOICE_MAP minus the Japanese voices 93/94). */
export declare const VOICE_FILES: Readonly<Record<number, string>>;
/** Default voice per language when the voice list is empty (used by voice blending). */
export declare const DEFAULT_VOICE: Readonly<Record<LangId, readonly number[]>>;
/** [phonemizer letter, female base voice id, male base voice id, base voice blend weight, original voice blend weight] */
export type LanguageBlend = readonly [LangLetter, number, number, number, number];
export type ForeignLangId = Exclude<LangId, 0>;
export declare const LANGUAGE_MAP: Readonly<Record<ForeignLangId, LanguageBlend>>;
export declare const PREFIX: Readonly<Record<LangId, string>>;
export declare const SUFFIX: Readonly<Record<LangId, string>>;
/** `phoneme_limit` passed to recursive_split_text by preprocess_task (internal safety margin below MAX_TOKENS). */
export declare const SPLIT_PHONEME_LIMIT = 500;
/** Python `str.isspace()` for a single code point. */
export declare function isPySpace(ch: string): boolean;
/** Python `str.strip()` (no arguments). */
export declare function pyStrip(s: string): string;
/** Python `len(str)`: number of code points. */
export declare function cpLen(s: string): number;
/** Python `str.translate(table)` with a `str.maketrans` dict table (`null` deletes). */
export declare function translate(text: string, table?: Readonly<Record<string, string | null>>): string;
export declare function convertSingleQuotes(text: string): string;
/**
 * Convert straight double quotes to curly double quotes, handling opening and
 * closing quotes, resetting at newlines and removing misplaced spaces inside
 * quotes. Faithful port of the Python including its quirks.
 */
export declare function convertDoubleQuotes(text: string): string;
/**
 * 1. If the string has no letters or numbers, return it unchanged.
 * 2. Temporarily ignore trailing CLOSERS.
 * 3. If the core already ends with "..." or ?/!, do nothing.
 * 4. If it ends with sentence punctuation, replace that character with "...".
 * 5. Otherwise append "...".
 * 6. Re-attach the trailing closers.
 */
export declare function addEllipsis(text: string): string;
export declare function preprocessText(text: string): string;
/** Rewrites `**this**` to `—!this!!` and `*this*` to `"this!` (applied before the phonemizer). */
export declare function rewriteEmphasis(text: string): string;
/** 'b' when at least half of the voices are British (so also for an empty list), else 'a'. Throws on an unknown id (Python raises TypeError). */
export declare function isBritish(voiceIds: readonly number[]): 'a' | 'b';
/** Finds the best split point (code point index) near the middle of the text. `maxLen` is unused, as in the Python. */
export declare function findBestSplitPoint(text: string, maxLen: number): number;
/** Synchronous phonemizer: text + one-letter language -> phoneme string. */
export type Phonemizer = (text: string, letter: LangLetter) => string;
/**
 * Recursively splits text into chunks whose phoneme strings have fewer than
 * `phonemeLimit` code points, preferring splits near the midpoint.
 */
export declare function recursiveSplitText(text: string, phonemizer: Phonemizer, letter: LangLetter, phonemeLimit?: number): string[];
export interface PlannedItem {
    phonemes: string;
    prefixPhonemes: string;
    suffixPhonemes: string;
    /** Row of the 510-row voice tensor to use (the `slice_index` passed to make_voice), 0..509. */
    styleIndex: number;
}
export interface SegmentPlan {
    letter: LangLetter;
    /** Empty when the segment produces no audio (old status 1 = pause). */
    items: PlannedItem[];
}
/**
 * Text part of preprocess_task: preprocess, add ellipsis, choose the phonemizer
 * letter, phonemize, and either attach prefix/suffix context (short texts) or
 * split into chunks (long texts).
 *
 * `phonemize` is the app's phonemizer wrapper (it is expected to apply
 * rewriteEmphasis itself, like the Python phonemize() does). `bookLang` only
 * drives voice blending, which is not part of this function; it is accepted
 * for signature parity with the Python.
 */
export declare function planSegment(text: string, prefix: string, suffix: string, segLang: LangId, bookLang: LangId, voiceIds: readonly number[], phonemize: Phonemizer): SegmentPlan;
