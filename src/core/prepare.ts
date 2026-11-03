// preprocess_task(): text -> inference items (phoneme ids + style rows + gains). Text worker side.

import type { InferenceItem, LangLetter, SegmentSpec } from './types.js';
import { planSegment } from './preprocess.js';
import type { Phonemizer } from './phonemize.js';
import type { VoiceBank } from './voices.js';
import { joinIds } from './slicing.js';

export async function prepareSegment(spec: SegmentSpec, ph: Phonemizer, voices: VoiceBank): Promise<{ items: InferenceItem[]; letter: LangLetter }> {
  const plan = planSegment(spec.text, spec.prefix, spec.suffix, spec.segLang, spec.bookLang, spec.voiceIds, (t, l) => ph.phonemize(t, l));
  const items: InferenceItem[] = [];
  for (const p of plan.items) {
    const target = ph.ids(p.phonemes);
    if (target.length === 0) continue;
    const prefix = ph.ids(p.prefixPhonemes);
    const suffix = ph.ids(p.suffixPhonemes);
    const { style, gainDb } = await voices.makeVoice(spec.voiceIds, p.styleIndex, spec.bookLang, spec.filter);
    items.push({
      ids: joinIds(prefix, target, suffix, ph.spaceId),
      prefixLen: prefix.length,
      targetLen: target.length,
      hasPrefix: prefix.length > 0,
      hasSuffix: suffix.length > 0,
      style,
      gainDb,
    });
  }
  return { items, letter: plan.letter };
}
