// Pure text preprocessing for the TTS pipeline.
//
// This is a byte-for-byte port of the text handling in tts_single.py
// (TRANS_TABLE, convert_single_quotes, convert_double_quotes, add_ellipsis,
// preprocess_text, find_best_split_point, recursive_split_text, is_british and
// the text part of preprocess_task). No DOM or Node APIs are used.
//
// Fidelity notes (Python str vs JS string):
// - Python indexes code points, JS indexes UTF-16 units. Everything that does
//   length arithmetic or character indexing here works on `Array.from(str)`
//   (one element per code point) so emoji/astral characters behave identically.
// - Python's `str.isspace()`, `str.strip()` and `re` `\s` all use the same
//   Unicode whitespace set, which differs from JS `\s`/`trim()` in both
//   directions (Python has U+001C..U+001F and U+0085, JS has U+FEFF). We use an
//   explicit character class (PY_SPACE) everywhere instead of `\s`/`trim()`.
// - Python `str.isalnum()` / `re` `\w` are Unicode aware; we use `\p{L}\p{N}`
//   (+ `_` for `\w`) with the `u` flag, which matches Python's definition
//   (general category L* or Numeric_Type != None) up to the Unicode version
//   of the engine. `\b` is emulated with lookarounds on the same class.
// - Python `.` (no DOTALL) matches everything but `\n`; JS `.` also excludes
//   `\r`, U+2028 and U+2029, so `[^\n]` is used where the Python has `.`.

import type { LangId, LangLetter } from './types.js';
import { MAX_TOKENS } from './types.js';

// ---------------------------------------------------------------------------
// Constants (tts_single.py lines 47-172)
// ---------------------------------------------------------------------------

/** `str.maketrans` table: value `null` means "delete this character". */
export const TRANS_TABLE: Readonly<Record<string, string | null>> = Object.freeze({
  '\t': ' ',
  '{': null,
  '}': null,
  '^': null,
  '~': null,
  '_': null,
  '‘': "'",
  '’': "'",
  '«': '“',
  '»': '”',
  '@': ' at ',
  '&': 'and',
  '¿': null,
});

export const CLOSERS = ')]}"\'’„”“»』」】）';
export const QUESTION_EXCLAMATION: readonly string[] = Object.freeze(Array.from('?!¿¡？！'));
export const PUNCTUATION_TO_REPLACE: readonly string[] = Object.freeze(
  Array.from('.,:;。、．，：；…।॥'),
);

/** Voice id -> voice file name without the `.pt` extension (VOICE_MAP minus the Japanese voices 93/94). */
export const VOICE_FILES: Readonly<Record<number, string>> = Object.freeze({
  10: 'af_clara',
  11: 'af_sophia',
  12: 'af_lily',
  13: 'af_rosalind',
  14: 'af_ashley',
  15: 'af_vee',
  16: 'af_old_woman',
  17: 'af_whisper',
  18: 'af_sally',
  20: 'am_mark',
  21: 'am_announcer_us',
  22: 'am_william',
  23: 'am_jonathan',
  24: 'am_croaky',
  25: 'am_old_man',
  26: 'am_frank',
  27: 'am_nicholas',
  28: 'am_edmund',
  29: 'am_gabriel',
  40: 'bf_margaret',
  41: 'bf_fiona',
  42: 'bf_nia',
  43: 'bf_winda',
  44: 'bf_emily',
  45: 'bf_alice',
  46: 'bf_julia',
  47: 'bf_isabella',
  48: 'bf_sylvia',
  50: 'bm_king',
  51: 'bm_arthur',
  52: 'bm_announcer_gb',
  53: 'bm_edmund',
  54: 'bm_gideon',
  55: 'bm_percival',
  56: 'bm_merlin',
  57: 'bm_elias',
  58: 'bm_simon',
  59: 'bm_samuel',
  60: 'bm_daniel',
  61: 'bm_harry',
  62: 'bm_fred',
  70: 'af_delphine',
  71: 'af_elena',
  72: 'bf_aisha',
  73: 'af_mei',
  74: 'am_riccardo',
  75: 'bm_rajesh',
  76: 'am_sanjay',
  77: 'am_jin',
  90: 'hm_base',
  91: 'zf_base',
  92: 'zm_base',
  95: 'fm_base',
  96: 'sm_base',
  97: 'sf_base',
  98: 'pm_base',
  99: 'pf_base',
});

/** Default voice per language when the voice list is empty (used by voice blending). */
export const DEFAULT_VOICE: Readonly<Record<LangId, readonly number[]>> = Object.freeze({
  0: [50], // US
  1: [70], // French
  2: [10], // Spanish
  3: [74], // Italian
  4: [29], // Portuguese
  5: [75], // Hindi
  6: [73], // Chinese
});

/** [phonemizer letter, female base voice id, male base voice id, base voice blend weight, original voice blend weight] */
export type LanguageBlend = readonly [LangLetter, number, number, number, number];
export type ForeignLangId = Exclude<LangId, 0>;

export const LANGUAGE_MAP: Readonly<Record<ForeignLangId, LanguageBlend>> = Object.freeze({
  1: ['f', 70, 95, 1.0, 0.7], // French
  2: ['e', 97, 96, 0.7, 1.0], // Spanish
  3: ['i', 71, 74, 1.0, 1.0], // Italian
  4: ['p', 99, 98, 1.0, 1.0], // Portuguese
  5: ['h', 72, 90, 1.0, 0.9], // Hindi
  6: ['z', 91, 92, 1.0, 1.0], // Chinese
});

export const PREFIX: Readonly<Record<LangId, string>> = Object.freeze({
  0: 'Chapter two. The story continues. ', // English
  1: "Chapitre deux. L'histoire continue. ", // French
  2: 'Capítulo dos. La historia continúa. ', // Spanish
  3: 'Capitolo due. La storia continua. ', // Italian
  4: 'Capítulo dois. A história continua. ', // Portuguese
  5: 'अध्याय दो। कहानी जारी है। ', // Hindi
  6: '第二章。故事还在继续。 ', // Chinese
});

export const SUFFIX: Readonly<Record<LangId, string>> = Object.freeze({
  0: ' He said clearly and with emotion.', // English
  1: ' Il a dit clairement et avec émotion.', // French
  2: ' Dijo claramente y con emoción.', // Spanish
  3: ' Ha detto chiaramente e con emozione.', // Italian
  4: ' Ele disse claramente e com emoção.', // Portuguese
  5: ' उसने स्पष्ट रूप से और भावना के साथ कहा।', // Hindi
  6: ' 他字正腔圆、充满感情地说道。', // Chinese
});

/** `phoneme_limit` passed to recursive_split_text by preprocess_task (internal safety margin below MAX_TOKENS). */
export const SPLIT_PHONEME_LIMIT = 500;

// ---------------------------------------------------------------------------
// Python string semantics helpers
// ---------------------------------------------------------------------------

/**
 * Exactly the characters for which Python's `str.isspace()` is true
 * (= what `str.strip()` strips and what `re` `\s` matches on str).
 */
const PY_SPACE_CHARS =
  '\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0 ' +
  '           ' +
  '    　';
const PY_SPACE_SET: ReadonlySet<string> = new Set(Array.from(PY_SPACE_CHARS));
const PY_SPACE_CLASS = '[\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const PY_STRIP_RE = new RegExp(`^${PY_SPACE_CLASS}+|${PY_SPACE_CLASS}+$`, 'gu');
/** Python `\w` on str: `str.isalnum()` or `_`. */
const PY_WORD_CLASS = '[\\p{L}\\p{N}_]';
/** Python `str.isalnum()` for one code point. */
const PY_ALNUM_RE = /[\p{L}\p{N}]/u;

/** Python `str.isspace()` for a single code point. */
export function isPySpace(ch: string): boolean {
  return PY_SPACE_SET.has(ch);
}

/** Python `str.strip()` (no arguments). */
export function pyStrip(s: string): string {
  return s.replace(PY_STRIP_RE, '');
}

/** Python `len(str)`: number of code points. */
export function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Python `str.translate(table)` with a `str.maketrans` dict table (`null` deletes). */
export function translate(text: string, table: Readonly<Record<string, string | null>> = TRANS_TABLE): string {
  let out = '';
  for (const ch of text) {
    if (Object.hasOwn(table, ch)) {
      const v = table[ch];
      if (v !== null) out += v;
    } else {
      out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// convert_single_quotes (tts_single.py:359)
// ---------------------------------------------------------------------------

/** Python `re.finditer(r"\b\w+'\w+\b", text)` with Unicode `\w`; `\b` emulated with lookarounds. */
const CONTRACTION_RE = new RegExp(`(?<!${PY_WORD_CLASS})${PY_WORD_CLASS}+'${PY_WORD_CLASS}+(?!${PY_WORD_CLASS})`, 'gu');

export function convertSingleQuotes(text: string): string {
  // Define fancy quotes
  const leftQuote = '‘'; // Left single quotation mark
  const rightQuote = '’'; // Right single quotation mark

  const cps = Array.from(text);
  const n = cps.length;

  // Map UTF-16 unit index -> code point index (so regex match offsets line up with `cps`).
  const unitToCp = new Int32Array(text.length + 1);
  {
    let u = 0;
    for (let c = 0; c < n; c++) {
      const w = cps[c].length;
      for (let k = 0; k < w; k++) unitToCp[u + k] = c;
      u += w;
    }
    unitToCp[text.length] = n;
  }

  // Step 1: Create a set of positions that are part of contractions
  const contractionPositions = new Set<number>();
  for (const match of text.matchAll(CONTRACTION_RE)) {
    const start = unitToCp[match.index as number];
    const end = unitToCp[(match.index as number) + match[0].length];
    for (let i = start; i < end; i++) contractionPositions.add(i);
  }

  // Step 2: Use a single-pass algorithm to identify quotes
  const quotes: Array<[number, number]> = [];
  let inQuote = false;
  let quoteStart = -1;
  const boundaryChars = new Set(Array.from(' \t\n,.!?;:()[]{}"-<>'));

  for (let i = 0; i < n; i++) {
    const char = cps[i];
    if (char === "'" && !contractionPositions.has(i)) {
      if (!inQuote) {
        // Check if this could be an opening quote
        if (i === 0 || boundaryChars.has(cps[i - 1])) {
          inQuote = true;
          quoteStart = i;
        }
      } else {
        // Check if this could be a closing quote
        if (i === n - 1 || boundaryChars.has(cps[i + 1])) {
          quotes.push([quoteStart, i]);
          inQuote = false;
        }
      }
    }
  }

  // Step 3: Replace quotes
  if (quotes.length === 0) {
    return text;
  }

  const result = cps.slice();
  for (const [start, end] of quotes) {
    result[start] = leftQuote;
    result[end] = rightQuote;
  }
  return result.join('');
}

// ---------------------------------------------------------------------------
// convert_double_quotes (tts_single.py:402)
// ---------------------------------------------------------------------------

const DQ_OPEN_BEFORE = new Set(Array.from(" \t.,!?;:([{'\n"));
const DQ_CLOSE_AFTER = new Set(Array.from(" \t.,!?;:)]}'\n"));
const DQ_PUNCT_AFTER = new Set(Array.from('.,!?;:)]}'));
const DQ_BRACKETS = new Set(Array.from('([{'));

/**
 * Convert straight double quotes to curly double quotes, handling opening and
 * closing quotes, resetting at newlines and removing misplaced spaces inside
 * quotes. Faithful port of the Python including its quirks.
 */
export function convertDoubleQuotes(text: string): string {
  const cps = Array.from(text);
  const n = cps.length;
  let result: string[] = []; // Final result list
  let quoteStack: string[] = []; // To track nested quotes
  let i = 0;

  while (i < n) {
    const char = cps[i];

    if (char === '"') {
      // Determine if this is an opening or closing quote
      let isOpening = false;
      let isClosing = false;

      // Check if followed by space (potential opening)
      const followedBySpace = i + 1 < n && isPySpace(cps[i + 1]) && cps[i + 1] !== '\n';

      // Check if preceded by space (potential closing)
      const precededBySpace = i > 0 && isPySpace(cps[i - 1]) && cps[i - 1] !== '\n';

      // Look behind to check context
      if (i === 0 || DQ_OPEN_BEFORE.has(cps[i - 1])) {
        isOpening = true;
      }

      // Look ahead to check context
      if (i === n - 1 || DQ_CLOSE_AFTER.has(cps[i + 1])) {
        isClosing = true;
      }

      // If it could be either, decide based on nesting level
      if (isOpening && isClosing) {
        // If there is a character before and whitespace or end after, prefer closing
        const nextIsWsOrEnd = i === n - 1 || isPySpace(cps[i + 1]);
        const prevIsChar = i > 0 && !isPySpace(cps[i - 1]);
        if (prevIsChar && nextIsWsOrEnd) {
          isOpening = false;
          isClosing = true;
        } else if (quoteStack.length === 0) {
          // default if truly ambiguous
          isOpening = true;
          isClosing = false;
        } else {
          isOpening = false;
          isClosing = true;
        }
      }

      // If still not determined, use quote stack state
      if (!isOpening && !isClosing) {
        if (quoteStack.length === 0) {
          isOpening = true; // If we're not in a quote, it's opening
        } else {
          isClosing = true; // If we're in a quote, it's closing
        }
      }

      if (isOpening) {
        // Process opening quote
        // Remove spaces immediately before opening quote if preceded by punctuation or bracket
        if (i > 0 && precededBySpace) {
          // Check if there's a bracket or punctuation before the spaces
          let spaceStart = i - 1;
          while (spaceStart >= 0 && isPySpace(cps[spaceStart]) && cps[spaceStart] !== '\n') {
            spaceStart -= 1;
          }

          // If we found a bracket or punctuation, remove the spaces
          if (spaceStart >= 0 && DQ_BRACKETS.has(cps[spaceStart])) {
            // Python: result = result[:-(i - space_start - 1)]  (i - space_start - 1 >= 1 here)
            result = result.slice(0, -(i - spaceStart - 1));
          }
        }

        result.push('“'); // Left double quote
        quoteStack.push('"'); // Push to stack

        // Skip spaces immediately after opening quote
        if (followedBySpace) {
          i += 1;
          while (i < n && isPySpace(cps[i]) && cps[i] !== '\n') {
            i += 1;
          }
          i -= 1; // Adjust for the increment at the end of the loop
        }
      } else if (isClosing) {
        // Process closing quote
        // Remove spaces immediately before closing quote
        if (precededBySpace) {
          // Remove trailing space(s) from result
          while (result.length > 0 && isPySpace(result[result.length - 1]) && result[result.length - 1] !== '\n') {
            result.pop();
          }
        }

        result.push('”'); // Right double quote
        if (quoteStack.length > 0) {
          quoteStack.pop(); // Pop from stack if not empty
        }

        // Handle spaces after closing quote before punctuation
        // (Python checks text[i] == ' ' where text[i] is the quote itself, so this never fires; kept for fidelity.)
        if (i < n - 1 && cps[i] === ' ') {
          let j = i;
          while (j < n && isPySpace(cps[j]) && cps[j] !== '\n') {
            j += 1;
          }
          // If next non-space is closing bracket or punctuation, skip the spaces
          if (j < n && DQ_PUNCT_AFTER.has(cps[j])) {
            i = j - 1; // -1 because we'll increment i at the end of the loop
          }
        }
      }

      // Move to next character
      i += 1;

      // Skip spaces between closing quote and punctuation
      if (isClosing && i < n) {
        // Skip spaces after closing quote but before punctuation
        let j = i;
        while (j < n && isPySpace(cps[j]) && cps[j] !== '\n') {
          j += 1;
        }

        // If next non-space is punctuation, skip the spaces
        if (j < n && DQ_PUNCT_AFTER.has(cps[j])) {
          i = j;
        }
      }
    } else if (char === '\n') {
      // Handle newlines - reset quote state
      result.push(char);
      quoteStack = []; // Reset quote stack on newline
      i += 1;
    } else {
      // Handle all other characters
      result.push(char);
      i += 1;
    }
  }

  return result.join('');
}

// ---------------------------------------------------------------------------
// add_ellipsis (tts_single.py:538)
// ---------------------------------------------------------------------------

/**
 * 1. If the string has no letters or numbers, return it unchanged.
 * 2. Temporarily ignore trailing CLOSERS.
 * 3. If the core already ends with "..." or ?/!, do nothing.
 * 4. If it ends with sentence punctuation, replace that character with "...".
 * 5. Otherwise append "...".
 * 6. Re-attach the trailing closers.
 */
export function addEllipsis(text: string): string {
  // Rule 1: If the string is empty or has no letters/numbers, do nothing.
  if (!PY_ALNUM_RE.test(text)) {
    return text;
  }

  // --- Step 2: Separate the core string from trailing closers ---
  const cps = Array.from(text);
  let lastCoreCharIndex = -1;
  for (let i = cps.length - 1; i >= 0; i--) {
    if (!CLOSERS.includes(cps[i])) {
      lastCoreCharIndex = i;
      break;
    }
  }

  if (lastCoreCharIndex === -1) {
    return text; // No core content to modify.
  }

  const coreString = cps.slice(0, lastCoreCharIndex + 1).join('');
  const trailingClosers = cps.slice(lastCoreCharIndex + 1).join('');

  if (coreString.endsWith('...')) {
    return text; // Do nothing, this is perfect.
  }

  // --- Step 3: Check if the core string ends with ? or ! ---
  if (QUESTION_EXCLAMATION.some((p) => coreString.endsWith(p))) {
    return text;
  }

  // --- Step 4: Check if it ends with punctuation to be replaced ---
  const replaced = PUNCTUATION_TO_REPLACE.find((p) => coreString.endsWith(p));
  if (replaced !== undefined) {
    // Python: core_string[:-1] + "..."  (every entry is a single BMP code point)
    return coreString.slice(0, coreString.length - replaced.length) + '...' + trailingClosers;
  }

  // --- Step 5: If it ends with anything else, just append '...' ---
  return coreString + '...' + trailingClosers;
}

// ---------------------------------------------------------------------------
// preprocess_text (tts_single.py:699)
// ---------------------------------------------------------------------------

/** Python `re.sub(r'\s+([?!])', r'\1', text)` with Python's `\s`. */
const SPACE_BEFORE_QE_RE = new RegExp(`${PY_SPACE_CLASS}+([?!])`, 'gu');

export function preprocessText(text: string): string {
  if (text === '') {
    return '';
  }
  text = pyStrip(text);
  text = translate(text, TRANS_TABLE); // remove and translate from the translate table
  text = text.replace(SPACE_BEFORE_QE_RE, '$1'); // remove space before ? and !
  if (text.includes("'")) {
    text = convertSingleQuotes(text);
  }
  if (text.includes('"') || text.includes('“')) {
    text = convertDoubleQuotes(text);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Markdown emphasis rewrite from phonemize() (tts_single.py:603-604)
// ---------------------------------------------------------------------------

// Python: re.sub(r'( ?)\*\*(.*?)\*\*( ?)', r'—!\2!!', text)
//         re.sub(r'( ?)\*(.*?)\*( ?)',     r'"\2!',   text)
// Python `.` excludes only `\n`, hence `[^\n]` instead of `.`.
const BOLD_RE = /( ?)\*\*([^\n]*?)\*\*( ?)/gu;
const ITALIC_RE = /( ?)\*([^\n]*?)\*( ?)/gu;

/** Rewrites `**this**` to `—!this!!` and `*this*` to `"this!` (applied before the phonemizer). */
export function rewriteEmphasis(text: string): string {
  text = text.replace(BOLD_RE, '—!$2!!'); // process **this**
  text = text.replace(ITALIC_RE, '"$2!'); // process *this*
  return text;
}

// ---------------------------------------------------------------------------
// is_british (tts_single.py:647)
// ---------------------------------------------------------------------------

/** 'b' when at least half of the voices are British (so also for an empty list), else 'a'. Throws on an unknown id (Python raises TypeError). */
export function isBritish(voiceIds: readonly number[]): 'a' | 'b' {
  let british = 0;
  for (const id of voiceIds) {
    const voiceName = VOICE_FILES[id];
    if (voiceName === undefined) {
      throw new RangeError(`Unknown voice id ${id}`);
    }
    if (voiceName[0] === 'b') {
      british += 1;
    }
  }
  if (british >= voiceIds.length / 2) {
    return 'b';
  }
  return 'a';
}

// ---------------------------------------------------------------------------
// find_best_split_point (tts_single.py:711)
// ---------------------------------------------------------------------------

/** Finds the best split point (code point index) near the middle of the text. `maxLen` is unused, as in the Python. */
export function findBestSplitPoint(text: string, maxLen: number): number {
  void maxLen;
  const cps = Array.from(text);
  const n = cps.length;
  const idealMidpoint = Math.floor(n / 2);
  const splitCharsPriority = ['.?!;:。！？', ',', ' '];
  let bestSplitPoint = -1;
  let minDistance = Infinity;
  const searchRange = Math.max(50, Math.floor(n / 4));

  for (const splitChars of splitCharsPriority) {
    let foundAtThisLevel = false;
    for (let i = 0; i < searchRange; i++) {
      const posRight = idealMidpoint + i;
      if (posRight < n && splitChars.includes(cps[posRight])) {
        if (i < minDistance) {
          minDistance = i;
          bestSplitPoint = posRight + 1;
          foundAtThisLevel = true;
        }
        break;
      }
      const posLeft = idealMidpoint - 1 - i;
      if (posLeft >= 0 && splitChars.includes(cps[posLeft])) {
        if (i < minDistance) {
          minDistance = i;
          bestSplitPoint = posLeft + 1;
          foundAtThisLevel = true;
        }
        break;
      }
    }
    if (foundAtThisLevel && bestSplitPoint !== -1) {
      // pass
    } else {
      continue;
    }
    if (bestSplitPoint !== -1) {
      break;
    }
  }

  if (bestSplitPoint === -1) {
    let spaceFallbackPoint = -1;
    for (let i = 0; i < searchRange; i++) {
      const posRight = idealMidpoint + i;
      if (posRight < n && cps[posRight] === ' ') {
        spaceFallbackPoint = posRight + 1;
        break;
      }
      const posLeft = idealMidpoint - 1 - i;
      if (posLeft >= 0 && cps[posLeft] === ' ') {
        spaceFallbackPoint = posLeft + 1;
        break;
      }
    }
    if (spaceFallbackPoint !== -1) {
      bestSplitPoint = spaceFallbackPoint;
    } else {
      bestSplitPoint = idealMidpoint;
    }
  }

  bestSplitPoint = Math.max(1, Math.min(n - 1, bestSplitPoint));
  return bestSplitPoint;
}

// ---------------------------------------------------------------------------
// recursive_split_text (tts_single.py:762)
// ---------------------------------------------------------------------------

/** Synchronous phonemizer: text + one-letter language -> phoneme string. */
export type Phonemizer = (text: string, letter: LangLetter) => string;

/**
 * Recursively splits text into chunks whose phoneme strings have fewer than
 * `phonemeLimit` code points, preferring splits near the midpoint.
 */
export function recursiveSplitText(
  text: string,
  phonemizer: Phonemizer,
  letter: LangLetter,
  phonemeLimit: number = SPLIT_PHONEME_LIMIT,
): string[] {
  text = pyStrip(text);
  if (!text) {
    return [];
  }

  const phonemeString = phonemizer(text, letter);
  const tokenLength = cpLen(phonemeString);

  if (tokenLength < phonemeLimit) {
    return [text];
  }

  const cps = Array.from(text);
  let splitIndex = findBestSplitPoint(text, phonemeLimit);
  if (splitIndex <= 0 || splitIndex >= cps.length) {
    splitIndex = Math.floor(cps.length / 2);
    if (splitIndex === 0 || splitIndex === cps.length) {
      return [text];
    }
  }

  const leftPart = cps.slice(0, splitIndex).join('');
  const rightPart = cps.slice(splitIndex).join('');

  const leftChunks = recursiveSplitText(leftPart, phonemizer, letter, phonemeLimit);
  const rightChunks = recursiveSplitText(rightPart, phonemizer, letter, phonemeLimit);

  return leftChunks.concat(rightChunks);
}

// ---------------------------------------------------------------------------
// preprocess_task minus voice loading (tts_single.py:791)
// ---------------------------------------------------------------------------

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

function clampStyleIndex(n: number): number {
  return Math.max(0, Math.min(MAX_TOKENS - 1, n));
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
export function planSegment(
  text: string,
  prefix: string,
  suffix: string,
  segLang: LangId,
  bookLang: LangId,
  voiceIds: readonly number[],
  phonemize: Phonemizer,
): SegmentPlan {
  void bookLang;
  // Python phonemize() returns "" for "" without running the pipeline.
  const ph: Phonemizer = (s, l) => (s === '' ? '' : phonemize(s, l));

  text = preprocessText(text);
  if (text === '') {
    return { letter: 'a', items: [] };
  }
  text = addEllipsis(text);

  let langcodeLetter: LangLetter;
  if (segLang === 0) {
    langcodeLetter = isBritish(voiceIds);
  } else {
    langcodeLetter = LANGUAGE_MAP[segLang][0];
  }
  const phonemeString = ph(text, langcodeLetter);
  const tokenLength = cpLen(phonemeString);
  if (tokenLength === 0) {
    return { letter: langcodeLetter, items: [] };
  }

  if (tokenLength < MAX_TOKENS) {
    if (cpLen(text) + cpLen(prefix) + cpLen(suffix) < 24) {
      prefix = PREFIX[segLang] + prefix;
    }

    let prefixPhon = '';
    let suffixPhon = '';

    if (prefix) {
      prefixPhon = ph(addEllipsis(preprocessText(prefix)), langcodeLetter);
    }
    if (suffix) {
      suffixPhon = ph(preprocessText(suffix), langcodeLetter);
    }

    const lenP = prefixPhon ? cpLen(prefixPhon) + 1 : 0;
    const lenS = suffixPhon ? cpLen(suffixPhon) + 1 : 0;
    const lenWithBoth = tokenLength + lenP + lenS;
    const lenWithSuffixOnly = tokenLength + lenS;
    const lenWithPrefixOnly = tokenLength + lenP;

    let longTokenLength: number;
    if (lenWithBoth < MAX_TOKENS) {
      // Best case: Everything fits.
      longTokenLength = lenWithBoth;
    } else if (lenWithSuffixOnly < MAX_TOKENS) {
      // Fallback 1: Removing the prefix works.
      prefixPhon = '';
      longTokenLength = lenWithSuffixOnly;
    } else if (lenWithPrefixOnly < MAX_TOKENS) {
      // Fallback 2: Removing the suffix works.
      suffixPhon = '';
      longTokenLength = lenWithPrefixOnly;
    } else {
      // Worst case: Must remove both.
      prefixPhon = '';
      suffixPhon = '';
      longTokenLength = tokenLength;
    }

    return {
      letter: langcodeLetter,
      items: [
        {
          phonemes: phonemeString,
          prefixPhonemes: prefixPhon,
          suffixPhonemes: suffixPhon,
          styleIndex: clampStyleIndex(longTokenLength),
        },
      ],
    };
  }

  // Everything below this is for splitting text longer than 510. The prefix and suffix are excluded in this case.
  const textChunks = recursiveSplitText(text, ph, langcodeLetter, SPLIT_PHONEME_LIMIT);
  const items: PlannedItem[] = [];
  for (let chunk of textChunks) {
    chunk = pyStrip(chunk);
    if (!chunk) {
      continue;
    }

    // Phonemize each chunk resulting from the split
    const chunkPhonemes = ph(chunk, langcodeLetter);
    const chunkPhonemeLength = cpLen(chunkPhonemes);

    // Skip if phonemization fails or results in empty
    if (chunkPhonemeLength === 0) {
      continue;
    }

    // Defensive check: a chunk that still meets or exceeds the hard limit is dropped.
    if (chunkPhonemeLength >= MAX_TOKENS) {
      continue;
    }

    // No prefix/suffix for split parts.
    items.push({
      phonemes: chunkPhonemes,
      prefixPhonemes: '',
      suffixPhonemes: '',
      styleIndex: clampStyleIndex(chunkPhonemeLength),
    });
  }

  return { letter: langcodeLetter, items };
}
