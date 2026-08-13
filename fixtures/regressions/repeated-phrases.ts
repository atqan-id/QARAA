/**
 * Synthetic repeated-phrase corpus for deterministic location regressions.
 *
 * @license Apache-2.0
 */

import type { QuranCorpus, RecitationObservation } from '../../packages/core/src/index.ts';

const ayahPhonemes = [
  ['ra', 'ha', 'm', 'a'],
  ['q', 'l', 'b', 'x'],
  ['ra', 'ha', 'm', 'a'],
  ['s', 't', 'x', 'y'],
  ['ra', 'ha', 'm', 'a'],
  ['n', 'u', 'r', 'z'],
] as const;

export const repeatedPhraseCorpus: QuranCorpus = {
  corpusId: 'repeated-phrase-regressions',
  revision: '1',
  symbols: ayahPhonemes.flatMap((phonemes, ayahIndex) => phonemes.map((phoneme, wordIndex) => ({
    id: `s:1:${ayahIndex + 1}:${wordIndex + 1}:1`,
    text: phoneme,
    phoneme,
    location: {
      surah: 1,
      ayah: ayahIndex + 1,
      word: wordIndex + 1,
      symbol: 1,
    },
  }))),
  words: ayahPhonemes.flatMap((phonemes, ayahIndex) => phonemes.map((phoneme, wordIndex) => ({
    id: `w:1:${ayahIndex + 1}:${wordIndex + 1}`,
    text: phoneme,
    symbolIds: [`s:1:${ayahIndex + 1}:${wordIndex + 1}:1`],
    location: {
      surah: 1,
      ayah: ayahIndex + 1,
      word: wordIndex + 1,
    },
  }))),
};

export function phraseObservation(phonemes: readonly string[]): RecitationObservation {
  return {
    observationId: `observation-${phonemes.length}-${phonemes.slice(0, 4).join('-')}`,
    sourceRevision: 1,
    isFinal: false,
    receivedAtMs: 100,
    tokens: [{
      id: 'token-1',
      text: phonemes.join(''),
      phonemes,
      startMs: 0,
      endMs: 100,
      confidence: 0.95,
    }],
  };
}
