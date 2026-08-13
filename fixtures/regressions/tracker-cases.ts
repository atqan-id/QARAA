/**
 * Synthetic ordered corpus and observations for reading-tracker regressions.
 *
 * @license Apache-2.0
 */

import type { QuranCorpus, RecitationObservation } from '../../packages/core/src/index.ts';

const ayat = [
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
  ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'],
  ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'],
] as const;

export const trackerCorpus: QuranCorpus = {
  corpusId: 'reading-tracker-regressions',
  revision: '1',
  symbols: ayat.flatMap((phonemes, ayahIndex) => phonemes.map((phoneme, wordIndex) => ({
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
  words: ayat.flatMap((phonemes, ayahIndex) => phonemes.map((phoneme, wordIndex) => ({
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

export function trackerObservation(
  observationId: string,
  sourceRevision: number,
  phonemes: readonly string[],
  options: Readonly<{ isFinal?: boolean; confidence?: number }> = {},
): RecitationObservation {
  return {
    observationId,
    sourceRevision,
    isFinal: options.isFinal ?? false,
    receivedAtMs: sourceRevision * 10,
    tokens: [{
      id: `token-${observationId}`,
      text: phonemes.join(' '),
      phonemes,
      startMs: 0,
      endMs: 10,
      confidence: options.confidence ?? 1,
    }],
  };
}
