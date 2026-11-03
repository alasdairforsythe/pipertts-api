// Shared types. Keep this file dependency free.

/** 0 none, 1 reverb, 2 reverb2, 3 echo, 4 intercom, 5 muffled, 6 vivid, 7 loud, 8 quiet */
export type FilterId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
/** 0 EN, 1 FR, 2 ES, 3 IT, 4 PT, 5 HI, 6 ZH (Japanese is not supported) */
export type LangId = 0 | 1 | 2 | 3 | 4 | 5 | 6;
/** One-letter phonemizer language: a/b English (US/GB), e Spanish, f French, h Hindi, i Italian, p Portuguese, z Chinese */
export type LangLetter = 'a' | 'b' | 'e' | 'f' | 'h' | 'i' | 'p' | 'z';

/** Everything that influences the audio of one segment (the cache key is derived from this + model). */
export interface SegmentSpec {
  text: string;
  prefix: string;
  suffix: string;
  voiceIds: number[];
  /** user speed x100, 50..200 */
  speedPct: number;
  filter: FilterId;
  /** language of the segment (from <XX> tags), drives phonemization and context sentences */
  segLang: LangId;
  /** language of the book/project, drives voice blending with the base voices */
  bookLang: LangId;
}

export interface CharacterSettings {
  voiceIds: number[];
  /** x100 */
  speed: number;
}
export type Characters = Record<string, CharacterSettings>;

/** What ended a text segment: a speaker tag, a `((`, a newline, an underscore run, or the end of the text. */
export type SegmentBoundary = 'speaker' | 'invisible_start' | 'newline' | 'underline' | 'end';

/** Output of parseChapter(); offsets index the chapter text (UTF-16 units) for rendering. */
export type ParsedSegment =
  | {
      type: 'text';
      start: number;
      end: number;
      speaker: string;
      spec: SegmentSpec;
      /** underscore gap units after the segment (0.25 s each), 0..255 */
      gaps: number;
      /** whitespace-only span kept for display, produces no audio */
      displayOnly: boolean;
      /** what ended this segment; 'newline' means the segment closes its line (no suffix) */
      boundary: SegmentBoundary;
      /** end offset of the leading `[Name]<..>` tag when the segment starts with one (tag = text.slice(start, tagEnd)) */
      tagEnd?: number;
    }
  | { type: 'pause'; start: number; end: number; gaps: number }
  | {
      type: 'invisible';
      start: number;
      end: number;
      /** context text between the (( )), underscores already turned into '-' */
      text: string;
      /** end offset of the leading `[Name]<..>` tag when the segment starts with one */
      tagEnd?: number;
    };

/** One model call after preprocessing: token ids for prefix + " " + target + " " + suffix (spaces only next to a non-empty part). */
export interface InferenceItem {
  /** phoneme ids without BOS/EOS, exactly what the model's `tokens` input takes */
  ids: Int32Array;
  /** number of prefix ids (0 when there is no prefix) */
  prefixLen: number;
  /** number of target ids */
  targetLen: number;
  hasPrefix: boolean;
  hasSuffix: boolean;
  /** 256 floats, the style row for this item */
  style: Float32Array;
  gainDb: number;
}

export interface PreparedSegment {
  items: InferenceItem[];
  letter: LangLetter;
}

export const SAMPLE_RATE = 24000;
export const GAP_SECONDS = 0.25;
export const PAUSE_SECONDS = 0.25;
export const MAX_TOKENS = 510;
