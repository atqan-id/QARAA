/**
 * Minimal canonical corpus fixture for QARAA core contract tests.
 *
 * @license Apache-2.0
 */

import type { QuranCorpus } from '../../packages/core/src/corpus/types.ts';

export const minimalCorpus: QuranCorpus = {
  corpusId: 'minimal-quran',
  revision: '1',
  symbols: [
    {
      id: 's:1:1:1:1',
      text: 'بِ',
      phoneme: 'bi',
      location: { surah: 1, ayah: 1, word: 1, symbol: 1 },
    },
    {
      id: 's:1:1:1:2',
      text: 'سْ',
      phoneme: 's',
      location: { surah: 1, ayah: 1, word: 1, symbol: 2 },
    },
    {
      id: 's:1:1:2:1',
      text: 'مِ',
      phoneme: 'mi',
      location: { surah: 1, ayah: 1, word: 2, symbol: 1 },
    },
  ],
  words: [
    {
      id: 'w:1:1:1',
      text: 'بِسْمِ',
      symbolIds: ['s:1:1:1:1', 's:1:1:1:2'],
      location: { surah: 1, ayah: 1, word: 1 },
    },
    {
      id: 'w:1:1:2',
      text: 'اللَّهِ',
      symbolIds: ['s:1:1:2:1'],
      location: { surah: 1, ayah: 1, word: 2 },
    },
  ],
};
