import assert from 'node:assert/strict';
import test from 'node:test';

import {
  phraseObservation,
  repeatedPhraseCorpus,
} from '../../../fixtures/regressions/repeated-phrases.ts';
import { retrieveCandidatePositions } from '../src/alignment/candidates.ts';
import { indexCorpus, locateObservation } from '../src/index.ts';
import type { AlignmentMetricsSink, IndexedCorpus, QuranCorpus } from '../src/index.ts';

class ObservedPostings implements ReadonlyMap<string, readonly number[]> {
  readonly keysRead: string[] = [];
  readonly source: ReadonlyMap<string, readonly number[]>;
  readonly failOnRead: boolean;
  readonly maximumReads: number;

  constructor(
    source: ReadonlyMap<string, readonly number[]>,
    failOnRead = false,
    maximumReads = Number.POSITIVE_INFINITY,
  ) {
    this.source = source;
    this.failOnRead = failOnRead;
    this.maximumReads = maximumReads;
  }

  get size(): number {
    return this.source.size;
  }

  get(key: string): readonly number[] | undefined {
    this.keysRead.push(key);
    if (this.failOnRead) throw new Error('global postings must not be read');
    if (this.keysRead.length > this.maximumReads) {
      throw new Error('global posting query budget exceeded');
    }
    return this.source.get(key);
  }

  has(key: string): boolean {
    return this.source.has(key);
  }

  entries(): MapIterator<[string, readonly number[]]> {
    return this.source.entries();
  }

  keys(): MapIterator<string> {
    return this.source.keys();
  }

  values(): MapIterator<readonly number[]> {
    return this.source.values();
  }

  forEach(
    callbackfn: (
      value: readonly number[],
      key: string,
      map: ReadonlyMap<string, readonly number[]>,
    ) => void,
    thisArg?: unknown,
  ): void {
    this.source.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  [Symbol.iterator](): MapIterator<[string, readonly number[]]> {
    return this.source[Symbol.iterator]();
  }
}

function withPostings(index: IndexedCorpus, postings: ObservedPostings): IndexedCorpus {
  return Object.freeze({ ...index, phonemeNgramPostings: postings });
}

function longRepeatedCorpus(length: number): QuranCorpus {
  return {
    corpusId: 'candidate-cap',
    revision: '1',
    symbols: Array.from({ length }, (_, index) => ({
      id: `s:1:1:${index + 1}:1`,
      text: 'p',
      phoneme: 'p',
      location: { surah: 1, ayah: 1, word: index + 1, symbol: 1 },
    })),
    words: Array.from({ length }, (_, index) => ({
      id: `w:1:1:${index + 1}`,
      text: 'p',
      symbolIds: [`s:1:1:${index + 1}:1`],
      location: { surah: 1, ayah: 1, word: index + 1 },
    })),
  };
}

function singleAyahCorpus(phonemes: readonly string[]): QuranCorpus {
  return {
    corpusId: 'single-ayah',
    revision: '1',
    symbols: phonemes.map((phoneme, index) => ({
      id: `s:1:1:${index + 1}:1`,
      text: phoneme,
      phoneme,
      location: { surah: 1, ayah: 1, word: index + 1, symbol: 1 },
    })),
    words: phonemes.map((phoneme, index) => ({
      id: `w:1:1:${index + 1}`,
      text: phoneme,
      symbolIds: [`s:1:1:${index + 1}:1`],
      location: { surah: 1, ayah: 1, word: index + 1 },
    })),
  };
}

function multiAyahCorpus(ayahs: readonly (readonly string[])[]): QuranCorpus {
  return {
    corpusId: 'multi-ayah',
    revision: '1',
    symbols: ayahs.flatMap((phonemes, ayahIndex) => phonemes.map((phoneme, wordIndex) => ({
      id: `s:1:${ayahIndex + 1}:${wordIndex + 1}:1`,
      text: phoneme,
      phoneme,
      location: { surah: 1, ayah: ayahIndex + 1, word: wordIndex + 1, symbol: 1 },
    }))),
    words: ayahs.flatMap((phonemes, ayahIndex) => phonemes.map((phoneme, wordIndex) => ({
      id: `w:1:${ayahIndex + 1}:${wordIndex + 1}`,
      text: phoneme,
      symbolIds: [`s:1:${ayahIndex + 1}:${wordIndex + 1}:1`],
      location: { surah: 1, ayah: ayahIndex + 1, word: wordIndex + 1 },
    }))),
  };
}

function inspectionLimitedArray(length: number, maximumReads: number): readonly number[] {
  let reads = 0;
  return new Proxy(Array.from({ length }, () => 0), {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) {
        reads += 1;
        if (reads > maximumReads) throw new Error('posting inspection budget exceeded');
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

test('searches the active ayah and one previous ayah before global fallback', () => {
  const base = indexCorpus(repeatedPhraseCorpus);
  const postings = new ObservedPostings(base.phonemeNgramPostings, true);
  const result = locateObservation(
    withPostings(base, postings),
    phraseObservation(['ra', 'ha', 'm', 'a']),
    { cursorSymbol: 4, committedSymbol: 4 },
  );

  assert.equal(result.best?.symbolIndex, 0);
  assert.equal(result.best?.score, 1);
  assert.deepEqual(postings.keysRead, []);
});

test('uses one-to-three forward phoneme postings only below the local threshold', () => {
  const base = indexCorpus(repeatedPhraseCorpus);
  const postings = new ObservedPostings(base.phonemeNgramPostings);
  const result = locateObservation(
    withPostings(base, postings),
    phraseObservation(['n', 'u', 'r']),
    { cursorSymbol: 4, committedSymbol: 4 },
  );

  assert.equal(result.best?.symbolIndex, 20);
  assert.equal(result.best?.score, 1);
  assert.deepEqual(postings.keysRead, ['n u r', 'n u', 'u r', 'n', 'u', 'r']);
});

test('includes three phoneme positions beyond the active ayah in the local window', () => {
  const positions = retrieveCandidatePositions(
    indexCorpus(repeatedPhraseCorpus),
    ['m'],
    4,
    false,
  );

  assert.equal(positions.includes(8), true);
  assert.equal(positions.includes(9), true);
  assert.equal(positions.includes(10), true);
});

test('reserves local candidates for long previous, active, and forward regions', () => {
  const previous = Array.from({ length: 80 }, (_, index) => `previous-${index}`);
  const active = Array.from({ length: 80 }, (_, index) => `active-${index}`);
  const index = indexCorpus(multiAyahCorpus([
    previous,
    active,
    ['forward-1', 'forward-2', 'forward-3', 'forward-4'],
  ]));
  const positions = retrieveCandidatePositions(index, ['missing'], 120, false);

  assert.equal(positions.some((position) => position < 80), true);
  assert.equal(positions.includes(120), true);
  assert.equal(positions.includes(160), true);
  assert.equal(positions.includes(161), true);
  assert.equal(positions.includes(162), true);
  assert.equal(positions.length, 48);
});

test('anchors global fallback in the distant region when the first phoneme is wrong', () => {
  const index = indexCorpus(repeatedPhraseCorpus);
  const positions = retrieveCandidatePositions(index, ['wrong', 'u', 'r'], 4, true);
  const result = locateObservation(
    index,
    phraseObservation(['wrong', 'u', 'r']),
    { cursorSymbol: 4, committedSymbol: 4 },
  );

  assert.equal(positions.includes(20), true);
  assert.equal(result.best?.location.ayah, 6);
  assert.equal(result.best?.score, 2 / 3);
});

test('accounts for a leading insertion when translating a distant anchor', () => {
  const result = locateObservation(
    indexCorpus(repeatedPhraseCorpus),
    phraseObservation(['extra', 'n', 'u', 'r']),
    { cursorSymbol: 4, committedSymbol: 4 },
  );

  assert.equal(result.best?.symbolIndex, 20);
  assert.equal(result.best?.alignment.operations[0]?.kind, 'insertion');
  assert.equal(result.best?.alignment.editCount, 1);
});

test('accounts for a deletion before a distant anchor', () => {
  const phonemes = Array.from({ length: 260 }, (_, index) => (
    index % 2 === 0 ? 'a' : `filler-${index}`
  ));
  phonemes.splice(250, 4, 'a', 'b', 'c', 'd');
  const result = locateObservation(
    indexCorpus(singleAyahCorpus(phonemes)),
    phraseObservation(['a', 'c', 'd']),
    { cursorSymbol: 50, committedSymbol: 50 },
  );

  assert.equal(result.best?.symbolIndex, 250);
  assert.equal(result.best?.alignment.operations[1]?.kind, 'deletion');
  assert.equal(result.best?.alignment.editCount, 1);
});

test('gives a later rare trigram candidate budget before a common first trigram', () => {
  const phonemes = Array.from({ length: 260 }, () => 'q');
  phonemes.splice(250, 10, 'q', 'q', 'q', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7');
  const result = locateObservation(
    indexCorpus(singleAyahCorpus(phonemes)),
    phraseObservation(['q', 'q', 'q', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7']),
    { cursorSymbol: 50, committedSymbol: 50 },
  );

  assert.equal(result.best?.symbolIndex, 250);
  assert.equal(result.best?.score, 1);
});

test('evaluates a longer reference span when the observation deletes a phoneme', () => {
  const result = locateObservation(
    indexCorpus(repeatedPhraseCorpus),
    phraseObservation(['ra', 'm', 'a']),
    { cursorSymbol: 0, committedSymbol: 0 },
  );

  assert.equal(result.best?.symbolIndex, 0);
  assert.equal(result.best?.alignment.editCount, 1);
  assert.equal(result.best?.alignment.operations[1]?.kind, 'deletion');
});

test('evaluates a shorter reference span when the observation inserts a phoneme', () => {
  const result = locateObservation(
    indexCorpus(repeatedPhraseCorpus),
    phraseObservation(['ra', 'extra', 'ha', 'm', 'a']),
    { cursorSymbol: 0, committedSymbol: 0 },
  );

  assert.equal(result.best?.symbolIndex, 0);
  assert.equal(result.best?.alignment.editCount, 1);
  assert.equal(result.best?.alignment.operations[1]?.kind, 'insertion');
});

test('uses variable-span score margin before cursor distance for repeated starts', () => {
  const result = locateObservation(
    indexCorpus(singleAyahCorpus(['a', 'b', 'x', 'c', 'z', 'a', 'x', 'b', 'c'])),
    phraseObservation(['a', 'b', 'c']),
    { cursorSymbol: 0, committedSymbol: 0 },
  );

  assert.equal(result.best?.symbolIndex, 5);
  assert.equal(result.best?.score, 0.75);
  assert.equal(result.best.cursorDistance, 5);
  assert.ok(result.best.scoreMargin > (result.second?.scoreMargin ?? 0));
});

test('uses a neutral margin when a corpus-edge candidate has no runner-up span', () => {
  const result = locateObservation(
    indexCorpus(singleAyahCorpus(['a', 'x', 'x', 'x', 'x', 'a'])),
    phraseObservation(['a']),
    { cursorSymbol: 0, committedSymbol: 0 },
  );

  assert.equal(result.best?.symbolIndex, 0);
  const edge = [result.best, result.second].find((candidate) => candidate?.symbolIndex === 5);
  assert.equal(edge?.scoreMargin, 0);
});

test('reuses one invocation-local typed alignment workspace across candidates and spans', () => {
  const index = indexCorpus(longRepeatedCorpus(80));
  const NativeUint8Array = globalThis.Uint8Array;
  const NativeUint32Array = globalThis.Uint32Array;
  let typedArrayAllocations = 0;

  globalThis.Uint8Array = class extends NativeUint8Array {
    constructor(length: number) {
      typedArrayAllocations += 1;
      super(length);
    }
  } as typeof Uint8Array;
  globalThis.Uint32Array = class extends NativeUint32Array {
    constructor(length: number) {
      typedArrayAllocations += 1;
      super(length);
    }
  } as typeof Uint32Array;

  try {
    const result = locateObservation(
      index,
      phraseObservation(['p']),
      { cursorSymbol: 40, committedSymbol: 40 },
    );
    assert.equal(result.best?.score, 1);
  } finally {
    globalThis.Uint8Array = NativeUint8Array;
    globalThis.Uint32Array = NativeUint32Array;
  }

  assert.equal(typedArrayAllocations, 3);
});

test('rejects an oversized direct locator observation before workspace allocation or candidate work', () => {
  const index = indexCorpus(longRepeatedCorpus(160));
  const NativeUint8Array = globalThis.Uint8Array;
  const NativeUint32Array = globalThis.Uint32Array;
  let typedArrayAllocations = 0;
  let candidateEvaluations = 0;
  const metricsSink: AlignmentMetricsSink = {
    recordCandidateEvaluation() {
      candidateEvaluations += 1;
    },
    recordEditCell() {},
    recordCorpusSymbolAccess() {},
  };

  assert.doesNotThrow(() => locateObservation(
    indexCorpus(singleAyahCorpus(['p'])),
    phraseObservation(Array.from({ length: 128 }, () => 'p')),
    { cursorSymbol: 0, committedSymbol: 0 },
  ));

  globalThis.Uint8Array = class extends NativeUint8Array {
    constructor(length: number) {
      typedArrayAllocations += 1;
      super(length);
    }
  } as typeof Uint8Array;
  globalThis.Uint32Array = class extends NativeUint32Array {
    constructor(length: number) {
      typedArrayAllocations += 1;
      super(length);
    }
  } as typeof Uint32Array;

  try {
    assert.throws(() => locateObservation(
      index,
      phraseObservation(Array.from({ length: 129 }, () => 'p')),
      { cursorSymbol: 80, committedSymbol: 80, metricsSink },
    ), /128 phonemes/i);
  } finally {
    globalThis.Uint8Array = NativeUint8Array;
    globalThis.Uint32Array = NativeUint32Array;
  }

  assert.equal(typedArrayAllocations, 0);
  assert.equal(candidateEvaluations, 0);
});

test('does not read global postings at exactly 0.72 local score', () => {
  const reference = Array.from({ length: 25 }, (_, index) => `reference-${index}`);
  const actual = reference.map((phoneme, index) => index < 7 ? `wrong-${index}` : phoneme);
  const base = indexCorpus(singleAyahCorpus(reference));
  const postings = new ObservedPostings(base.phonemeNgramPostings, true);
  const result = locateObservation(
    withPostings(base, postings),
    phraseObservation(actual),
    { cursorSymbol: 0, committedSymbol: 0 },
  );

  assert.equal(result.best?.score, 0.72);
  assert.deepEqual(postings.keysRead, []);
});

test('reads global postings just below 0.72 local score', () => {
  const reference = Array.from({ length: 32 }, (_, index) => `reference-${index}`);
  const actual = reference.map((phoneme, index) => index < 9 ? `wrong-${index}` : phoneme);
  const base = indexCorpus(singleAyahCorpus(reference));
  const postings = new ObservedPostings(base.phonemeNgramPostings);
  const result = locateObservation(
    withPostings(base, postings),
    phraseObservation(actual),
    { cursorSymbol: 0, committedSymbol: 0 },
  );

  assert.equal(result.best?.score, 23 / 32);
  assert.ok(postings.keysRead.length > 0);
});

test('uses leading continuity before forward movement when earlier ranks tie', () => {
  const result = locateObservation(
    indexCorpus(singleAyahCorpus(['b', 'c', 'a', 'c', 'a', 'a', 'a'])),
    phraseObservation(['a', 'b', 'c']),
    { cursorSymbol: 1, committedSymbol: 1 },
  );

  assert.equal(result.best?.symbolIndex, 2);
  assert.equal(result.second?.symbolIndex, 0);
  assert.ok(result.best.continuity > result.second.continuity);
});

test('breaks repeated-phrase ties toward the smallest movement and marks a backward reread', () => {
  const result = locateObservation(
    indexCorpus(repeatedPhraseCorpus),
    phraseObservation(['ra', 'ha', 'm', 'a']),
    { cursorSymbol: 12, committedSymbol: 12 },
  );

  assert.equal(result.best?.symbolIndex, 8);
  assert.equal(result.second?.symbolIndex, 16);
  assert.equal(result.best?.score, 1);
  assert.ok(result.best.scoreMargin > 0);
  assert.equal(result.best?.isReread, true);
  assert.equal(result.best?.alignment.editCount, 0);
});

test('caps the combined local and global candidate set at 64 positions', () => {
  const index = indexCorpus(longRepeatedCorpus(160));
  const positions = retrieveCandidatePositions(index, ['p'], 80, true);

  assert.equal(positions.length, 64);
  assert.equal(new Set(positions).size, 64);
});

test('measures actual local and posting accesses during candidate retrieval', () => {
  const index = indexCorpus(longRepeatedCorpus(4_096));
  const accessed = new Set<number>();
  const metricsSink: AlignmentMetricsSink = {
    recordCandidateEvaluation() {},
    recordEditCell() {},
    recordCorpusSymbolAccess(symbolIndex) {
      accessed.add(symbolIndex);
    },
  };

  retrieveCandidatePositions(index, ['p'], 2_000, true, metricsSink);

  assert.ok(accessed.size > 2);
  assert.ok(accessed.size < index.symbols.length);
});

test('bounds n-gram queries independently of observation length', () => {
  const base = indexCorpus(singleAyahCorpus(['local']));
  const postings = new ObservedPostings(new Map(), false, 48);
  const actual = Array.from({ length: 512 }, (_, index) => `absent-${index}`);

  const positions = retrieveCandidatePositions(withPostings(base, postings), actual, 0, true);

  assert.equal(positions.length, 1);
  assert.ok(postings.keysRead.length <= 48);
});

test('bounds posting inspections even when translated starts are invalid duplicates', () => {
  const base = indexCorpus(singleAyahCorpus(['local']));
  const postings = new ObservedPostings(new Map([
    ['anchor', inspectionLimitedArray(1_000, 200)],
  ]));

  const positions = retrieveCandidatePositions(
    withPostings(base, postings),
    ['missing-0', 'missing-1', 'missing-2', 'missing-3', 'anchor'],
    0,
    true,
  );

  assert.equal(positions.length, 1);
});
