import type { Characters, FilterId, LangId, ParsedSegment } from './types.js';
/** `<XX>` language modifiers (looked up uppercased). Japanese is deliberately absent. */
export declare const LANGUAGE_TAGS: Readonly<Record<string, LangId>>;
/** `<xx>` filter modifiers (looked up lowercased). */
export declare const FILTER_TAGS: Readonly<Record<string, FilterId>>;
/** Lower-cases a character name and strips `<xx>` language tags: the key used for lookups. */
export declare function normalizeCharacterName(name: string | null | undefined): string;
/** A parsed `[Name]<mod>...` speaker tag. */
export interface SpeakerTag {
    /** Name as written between the brackets, trimmed; 'Narrator' for an empty `[]`. */
    name: string;
    /** Lookup key: normalizeCharacterName(name). */
    key: string;
    /** Language from the modifiers (last valid wins), null when none was given. */
    lang: LangId | null;
    /** Filter from the modifiers (first valid wins), 0 when none was given. */
    filter: FilterId;
    /** Number of characters the tag occupies (brackets plus glued modifiers). */
    length: number;
}
/**
 * Parses a speaker tag at the start of `tag` (e.g. "[Bob]<fr><echo>").
 * Returns null when the string does not start with `[..]`.
 */
export declare function parseSpeakerTag(tag: string): SpeakerTag | null;
/** Ordered unique character display names found in `[..]` tags, Narrator first; `[]` skipped. */
export declare function collectCharacters(text: string): string[];
/**
 * Splits a chapter into segments. Offsets are UTF-16 indices into `text`; the segments tile the
 * text exactly (each starts where the previous one ended), so a renderer can slice it.
 */
export declare function parseChapter(text: string, characters: Characters, bookLang: LangId): ParsedSegment[];
