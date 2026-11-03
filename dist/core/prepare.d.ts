import type { InferenceItem, LangLetter, SegmentSpec } from './types.js';
import type { Phonemizer } from './phonemize.js';
import type { VoiceBank } from './voices.js';
export declare function prepareSegment(spec: SegmentSpec, ph: Phonemizer, voices: VoiceBank): Promise<{
    items: InferenceItem[];
    letter: LangLetter;
}>;
