// Chapter text parser. Port of the parsing half of serializeChapterData() from the old
// piedpiper editor (editor.js); the byte-writing half was not ported.
//
// Grammar:
//   [Name]<mod><mod>...  speaker tag: zero or more <..> modifiers glued to the closing bracket.
//                        Modifiers are language tags (LANGUAGE_TAGS, last valid wins) or filter
//                        tags (FILTER_TAGS, first valid wins); unknown ones are ignored.
//                        `[]` is the Narrator. A bare <FR> that does not follow `[..]` is text.
//   ((text))             invisible context text (recognised at the start of a segment); any `((`
//                        ends the current segment. Underscores inside become '-'.
//   _                    the first `_` ends the segment; the run /[_\s]+/ is consumed and the
//                        number of `_` in it becomes the segment's gaps (0.25 s each).
//   \n                   ends the segment; every extra consecutive `\n` is a pause segment.
//
// Pure functions, no DOM. Single forward scan over the text plus two linear passes over the
// segment list (gap recount, prefix/suffix).
/** `<XX>` language modifiers (looked up uppercased). Japanese is deliberately absent. */
export const LANGUAGE_TAGS = Object.freeze({
    EN: 0,
    US: 0,
    GB: 0,
    UK: 0,
    FR: 1,
    ES: 2,
    SP: 2,
    IT: 3,
    PT: 4,
    HI: 5,
    ZH: 6,
    CH: 6,
    CN: 6,
});
/** `<xx>` filter modifiers (looked up lowercased). */
export const FILTER_TAGS = Object.freeze({
    reverb: 1,
    reverb2: 2,
    echo: 3,
    intercom: 4,
    muffled: 5,
    vivid: 6,
    loud: 7,
    quiet: 8,
});
const SPEED_MIN_PCT = 50;
const SPEED_MAX_PCT = 200;
const SPEED_DEFAULT_PCT = 100;
const MAX_GAPS = 255;
const NARRATOR = 'Narrator';
const NARRATOR_KEY = 'narrator';
// All regexes are created once. The sticky (`y`) ones are anchored at `lastIndex`.
/** Speaker tag at a given position: `[name]` followed by glued `<..>` modifiers. */
const TAG_AT = /\[(.*?)\]((?:<[^>]+>)*)/y;
/** Same grammar anchored at the start of a string (parseSpeakerTag). */
const TAG_WHOLE = /^\[(.*?)\]((?:<[^>]+>)*)/;
/** One `<..>` modifier inside the modifier string. */
const MODIFIER_G = /<([^>]+)>/g;
/** `[name]` anywhere (character list; modifiers ignored). */
const NAME_TAG_G = /\[(.*?)\]/g;
/** Underscore run (whitespace, including newlines, is part of the run). */
const UNDERLINE_RUN = /[_\s]+/y;
const UNDERSCORE_G = /_/g;
const LANG_TAG_LOWER_G = /<[a-z]{2}>/g;
const LANG_TAG_UPPER_G = /<[A-Z]{2}>/g;
const CODE_NEWLINE = 10;
const CODE_PAREN_OPEN = 40;
const CODE_BRACKET_OPEN = 91;
const CODE_UNDERSCORE = 95;
/** Lower-cases a character name and strips `<xx>` language tags: the key used for lookups. */
export function normalizeCharacterName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(LANG_TAG_LOWER_G, '')
        .trim();
}
/** Display form of a name as first written: original case, `<XX>` tags stripped. */
function cleanCharacterName(name) {
    return name.replace(LANG_TAG_UPPER_G, '').trim();
}
/**
 * Parses a speaker tag at the start of `tag` (e.g. "[Bob]<fr><echo>").
 * Returns null when the string does not start with `[..]`.
 */
export function parseSpeakerTag(tag) {
    const m = TAG_WHOLE.exec(tag);
    if (m === null)
        return null;
    return tagFromParts(m[1], m[2], m[0].length);
}
function tagFromParts(rawName, modifiers, length) {
    const name = rawName.trim() || NARRATOR;
    let lang = null;
    let filter = 0;
    if (modifiers.length > 0) {
        MODIFIER_G.lastIndex = 0;
        let mm;
        while ((mm = MODIFIER_G.exec(modifiers)) !== null) {
            const body = mm[1];
            const langKey = body.toUpperCase();
            if (Object.hasOwn(LANGUAGE_TAGS, langKey)) {
                lang = LANGUAGE_TAGS[langKey];
            }
            else if (filter === 0) {
                const filterKey = body.toLowerCase();
                if (Object.hasOwn(FILTER_TAGS, filterKey))
                    filter = FILTER_TAGS[filterKey];
            }
        }
    }
    return { name, key: normalizeCharacterName(name), lang, filter, length };
}
const NARRATOR_TAG = {
    name: NARRATOR,
    key: NARRATOR_KEY,
    lang: null,
    filter: 0,
    length: NARRATOR.length + 2,
};
/** One linear scan of all `[..]` tags (modifiers ignored), as the old character panel did. */
function scanCharacterNames(text) {
    const order = [NARRATOR];
    const byKey = new Map([[NARRATOR_KEY, NARRATOR]]);
    NAME_TAG_G.lastIndex = 0;
    let m;
    while ((m = NAME_TAG_G.exec(text)) !== null) {
        const original = m[1].trim();
        if (!original)
            continue; // `[]` is the Narrator, not a character
        const key = normalizeCharacterName(original);
        if (!byKey.has(key)) {
            const display = cleanCharacterName(original);
            byKey.set(key, display);
            order.push(display);
        }
    }
    return { order, byKey };
}
/** Ordered unique character display names found in `[..]` tags, Narrator first; `[]` skipped. */
export function collectCharacters(text) {
    return scanCharacterNames(text).order;
}
function clampSpeed(pct) {
    return Math.max(SPEED_MIN_PCT, Math.min(SPEED_MAX_PCT, pct));
}
/** Characters keyed by normalized name (the old editor normalized the keys on load). */
function buildCharacterMap(characters) {
    const map = new Map();
    for (const name of Object.keys(characters)) {
        const settings = characters[name];
        if (!settings)
            continue;
        const key = normalizeCharacterName(name);
        let entry = map.get(key);
        if (entry === undefined) {
            entry = { voiceIds: [], speedPct: null };
            map.set(key, entry);
        }
        if (settings.voiceIds)
            entry.voiceIds = settings.voiceIds.slice();
        // 0 / missing speed means "unset" (old: `if (settings.speed)`); the stored value is x100.
        if (settings.speed)
            entry.speedPct = clampSpeed(Math.round(settings.speed));
    }
    return map;
}
function makeSpeaker(tag, ctx) {
    const entry = ctx.chars.get(tag.key);
    return {
        display: ctx.names.get(tag.key) ?? tag.name,
        // a character without voices speaks with the narrator's voices
        voiceIds: entry !== undefined && entry.voiceIds.length > 0 ? entry.voiceIds : ctx.narratorVoices,
        speedPct: entry !== undefined && entry.speedPct !== null ? entry.speedPct : SPEED_DEFAULT_PCT,
        filter: tag.filter,
        // language and filter are not inherited from the previous speaker
        segLang: tag.lang ?? ctx.bookLang,
    };
}
/**
 * Splits a chapter into segments. Offsets are UTF-16 indices into `text`; the segments tile the
 * text exactly (each starts where the previous one ended), so a renderer can slice it.
 */
export function parseChapter(text, characters, bookLang) {
    const chars = buildCharacterMap(characters);
    const narratorEntry = chars.get(NARRATOR_KEY);
    const ctx = {
        chars,
        names: scanCharacterNames(text).byKey,
        narratorVoices: narratorEntry !== undefined && narratorEntry.voiceIds.length > 0 ? narratorEntry.voiceIds : [],
        bookLang,
    };
    const out = [];
    // underscores consumed by each segment's boundary run, kept for display-only segments too
    const runGaps = [];
    const n = text.length;
    let active = makeSpeaker(NARRATOR_TAG, ctx);
    // once `))` is missing after some position it is missing after every later position
    let noCloseFrom = -1;
    let ci = 0;
    // ---- First pass: segment boundaries and speaker state ----
    while (ci < n) {
        const segStart = ci;
        let tagEnd = -1;
        TAG_AT.lastIndex = ci;
        const tag = TAG_AT.exec(text);
        if (tag !== null) {
            active = makeSpeaker(tagFromParts(tag[1], tag[2], tag[0].length), ctx);
            ci += tag[0].length;
            tagEnd = ci;
        }
        // `((..))` at the start of the segment: invisible context text
        if (ci + 1 < n && text.charCodeAt(ci) === CODE_PAREN_OPEN && text.charCodeAt(ci + 1) === CODE_PAREN_OPEN) {
            ci += 2;
            let close = -1;
            if (noCloseFrom === -1 || ci < noCloseFrom) {
                close = text.indexOf('))', ci);
                if (close === -1)
                    noCloseFrom = ci;
            }
            if (close !== -1) {
                const seg = {
                    type: 'invisible',
                    start: segStart,
                    end: close + 2,
                    text: text.slice(ci, close).replace(UNDERSCORE_G, '-'),
                };
                if (tagEnd >= 0)
                    seg.tagEnd = tagEnd;
                out.push(seg);
                runGaps.push(0);
                ci = close + 2;
                continue;
            }
            // unclosed `((`: the two parentheses are skipped and the rest is ordinary text
        }
        // Scan forward to the nearest boundary.
        let bIdx = n;
        let bType = 'end';
        let bLen = 0;
        let gapCount = 0;
        let bracketFailed = false;
        for (let i = ci; i < n; i++) {
            const c = text.charCodeAt(i);
            if (c === CODE_NEWLINE) {
                bIdx = i;
                bType = 'newline';
                let k = i + 1;
                while (k < n && text.charCodeAt(k) === CODE_NEWLINE)
                    k++;
                bLen = k - i; // 1 + number of extra newlines (each extra one is a pause)
                break;
            }
            if (c === CODE_UNDERSCORE) {
                bIdx = i;
                bType = 'underline';
                UNDERLINE_RUN.lastIndex = i;
                const run = UNDERLINE_RUN.exec(text);
                bLen = run === null ? 1 : run[0].length;
                for (let k = i; k < i + bLen; k++)
                    if (text.charCodeAt(k) === CODE_UNDERSCORE)
                        gapCount++;
                break;
            }
            if (c === CODE_PAREN_OPEN) {
                if (i + 1 < n && text.charCodeAt(i + 1) === CODE_PAREN_OPEN) {
                    bIdx = i;
                    bType = 'invisible_start';
                    break;
                }
            }
            else if (c === CODE_BRACKET_OPEN && !bracketFailed) {
                TAG_AT.lastIndex = i;
                if (TAG_AT.test(text)) {
                    bIdx = i;
                    bType = 'speaker';
                    break;
                }
                // Old behaviour: only the first `[` after the segment start is tried.
                bracketFailed = true;
            }
        }
        // The span includes the tag, the text, the whole underscore run or the first newline.
        const end = bIdx + (bType === 'underline' ? bLen : bType === 'newline' ? 1 : 0);
        if (end > segStart) {
            const content = text.slice(ci, bIdx).trim();
            const visible = content.length > 0;
            const spec = {
                text: content,
                prefix: '',
                suffix: '',
                voiceIds: active.voiceIds,
                speedPct: active.speedPct,
                filter: active.filter,
                segLang: active.segLang,
                bookLang,
            };
            const seg = {
                type: 'text',
                start: segStart,
                end,
                speaker: active.display,
                spec,
                gaps: visible && bType === 'underline' ? gapCount : 0,
                displayOnly: !visible,
                boundary: bType,
            };
            if (tagEnd >= 0)
                seg.tagEnd = tagEnd;
            out.push(seg);
            runGaps.push(bType === 'underline' ? gapCount : 0);
        }
        if (bType === 'newline' && bLen > 1) {
            for (let k = 1; k < bLen; k++) {
                out.push({ type: 'pause', start: bIdx + k, end: bIdx + k + 1, gaps: 0 });
                runGaps.push(0);
            }
        }
        ci = bIdx + bLen;
        if (ci <= segStart && ci < n)
            ci = segStart + 1; // cannot happen; guards against a stall
    }
    // ---- Second pass A: gaps = all underscores between this text and the next audible text ----
    // (the old editor recounted with indexOf(text), which broke on repeated text; this uses the
    // runs recorded at their real positions). Clamped to 255, the old uint8 range.
    let acc = 0;
    for (let i = out.length - 1; i >= 0; i--) {
        acc += runGaps[i];
        const s = out[i];
        if (s.type === 'text' && !s.displayOnly) {
            s.gaps = acc > MAX_GAPS ? MAX_GAPS : acc;
            acc = 0;
        }
    }
    // ---- Second pass B: prefix/suffix within each line ----
    // A line is the run of segments up to and including the one whose boundary is a newline;
    // a pause is a line of its own. Underscore runs that swallowed newlines do not end a line.
    let lineStart = 0;
    for (let i = 0; i < out.length; i++) {
        const s = out[i];
        if (s.type === 'pause') {
            if (i > lineStart)
                fillContext(out, lineStart, i - 1);
            lineStart = i + 1;
        }
        else if (s.type === 'text' && s.boundary === 'newline') {
            fillContext(out, lineStart, i);
            lineStart = i + 1;
        }
    }
    if (lineStart < out.length)
        fillContext(out, lineStart, out.length - 1);
    // ---- Second pass C: a pause inherits the gaps of a following text that ends in underscores ----
    for (let i = 0; i + 1 < out.length; i++) {
        const s = out[i];
        if (s.type !== 'pause')
            continue;
        const next = out[i + 1];
        if (next.type === 'text' && !next.displayOnly && next.boundary === 'underline')
            s.gaps = next.gaps;
    }
    return out;
}
/** Text a segment contributes to its neighbours' context (empty for pauses and display-only spans). */
function contextText(s) {
    if (s.type === 'text')
        return s.displayOnly ? '' : s.spec.text;
    if (s.type === 'invisible')
        return s.text.trim();
    return '';
}
/** Fills prefix/suffix of the audible segments in out[a..b] (one line), joining parts with ' '. */
function fillContext(out, a, b) {
    let before = '';
    for (let j = a; j <= b; j++) {
        const s = out[j];
        if (s.type === 'text' && !s.displayOnly)
            s.spec.prefix = before;
        const part = contextText(s);
        if (part.length > 0)
            before = before.length > 0 ? before + ' ' + part : part;
    }
    let after = '';
    for (let j = b; j >= a; j--) {
        const s = out[j];
        if (s.type === 'text' && !s.displayOnly)
            s.spec.suffix = s.boundary === 'newline' ? '' : after;
        const part = contextText(s);
        if (part.length > 0)
            after = after.length > 0 ? part + ' ' + after : part;
    }
}
