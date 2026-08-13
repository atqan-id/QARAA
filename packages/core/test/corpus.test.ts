import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { minimalCorpus } from '../../../fixtures/corpus/minimal.ts';
import { resolveTestArguments, resolveTestPaths } from './run.mjs';
import {
  indexCorpus,
  validateCorpus,
  validateObservation,
} from '../src/index.ts';
import type { QuranCorpus, RecitationObservation } from '../src/index.ts';

function copyCorpus(): QuranCorpus {
  return structuredClone(minimalCorpus);
}

function observation(overrides: Partial<RecitationObservation> = {}): RecitationObservation {
  return {
    observationId: 'observation-1',
    sourceRevision: 0,
    isFinal: false,
    receivedAtMs: 100,
    tokens: [{
      id: 'token-1',
      text: 'bismi',
      phonemes: ['bi', 's', 'mi'],
      startMs: 0,
      endMs: 100,
      confidence: 0.9,
    }],
    ...overrides,
  };
}

test('validates an addressable corpus and derives immutable lookup indexes', () => {
  const corpus = copyCorpus();
  const beforeIndexing = structuredClone(corpus);

  assert.doesNotThrow(() => validateCorpus(corpus));

  const indexed = indexCorpus(corpus);
  assert.equal(indexed.symbolsById.get('s:1:1:1:2')?.phoneme, 's');
  assert.equal(indexed.wordsById.get('w:1:1:2')?.text, 'اللَّهِ');
  assert.deepEqual(indexed.symbols.map(({ id }) => id), [
    's:1:1:1:1',
    's:1:1:1:2',
    's:1:1:2:1',
  ]);
  assert.deepEqual(indexed.wordSymbolRanges.get('w:1:1:1'), { start: 0, end: 2 });
  assert.deepEqual(indexed.ayahSymbolRanges.get('1:1'), { start: 0, end: 3 });
  assert.deepEqual(indexed.phonemeNgramPostings.get('bi s'), [0]);
  assert.equal(Object.isFrozen(indexed.symbols), true);
  assert.equal(Object.isFrozen(indexed.phonemeNgramPostings.get('bi s')), true);
  assert.equal('set' in indexed.symbolsById, false);
  assert.deepEqual(corpus, beforeIndexing);

  Object.assign(corpus.symbols[0]!, { phoneme: 'changed' });
  assert.equal(indexed.symbolsById.get('s:1:1:1:1')?.phoneme, 'bi');
});

test('validates word order from captured symbol positions without scanning the symbol array', () => {
  const corpus = copyCorpus();
  const symbols = [...corpus.symbols];
  Object.defineProperty(symbols, 'indexOf', {
    value: () => {
      throw new Error('symbol array scan');
    },
  });
  corpus.symbols = symbols;

  assert.doesNotThrow(() => validateCorpus(corpus));
});

test('maps a focused basename to the nested package test path', () => {
  assert.deepEqual(resolveTestPaths(['corpus.test.ts']), [
    resolve(dirname(fileURLToPath(import.meta.url)), 'corpus.test.ts'),
  ]);
});

test('recognizes an absolute test selector without appending the full suite', () => {
  const corpusTestPath = resolve(dirname(fileURLToPath(import.meta.url)), 'corpus.test.ts');

  assert.deepEqual(resolveTestArguments([corpusTestPath]), [corpusTestPath]);
});

test('preserves Node test-runner flags while mapping focused test basenames', () => {
  assert.deepEqual(resolveTestArguments(['--test-name-pattern', 'immutable', 'corpus.test.ts']), [
    '--test-name-pattern',
    'immutable',
    resolve(dirname(fileURLToPath(import.meta.url)), 'corpus.test.ts'),
  ]);
  const [flag, value, ...testPaths] = resolveTestArguments(['--test-global-setup', 'corpus.test.ts']);
  assert.deepEqual([flag, value], [
    '--test-global-setup',
    'corpus.test.ts',
  ]);
  assert.equal(testPaths.includes(resolve(dirname(fileURLToPath(import.meta.url)), 'corpus.test.ts')), true);
});

test('rejects corpus IDs, locations, phonemes, and words that cannot form one address model', () => {
  const duplicateId = copyCorpus();
  duplicateId.symbols = [...duplicateId.symbols, { ...duplicateId.symbols[0]! }];
  assert.throws(() => validateCorpus(duplicateId), /duplicate symbol id/i);

  const nonMonotonic = copyCorpus();
  nonMonotonic.symbols = [nonMonotonic.symbols[1]!, nonMonotonic.symbols[0]!, nonMonotonic.symbols[2]!];
  assert.throws(() => validateCorpus(nonMonotonic), /monotonic/i);

  const missingSymbol = copyCorpus();
  missingSymbol.words = [{ ...missingSymbol.words[0]!, symbolIds: ['missing'] }, missingSymbol.words[1]!];
  assert.throws(() => validateCorpus(missingSymbol), /missing symbol/i);

  const emptyPhoneme = copyCorpus();
  emptyPhoneme.symbols = [{ ...emptyPhoneme.symbols[0]!, phoneme: '' }, ...emptyPhoneme.symbols.slice(1)];
  assert.throws(() => validateCorpus(emptyPhoneme), /phoneme/i);

  const spanningAyat = copyCorpus();
  spanningAyat.symbols = [
    spanningAyat.symbols[0]!,
    spanningAyat.symbols[1]!,
    { ...spanningAyat.symbols[2]!, location: { surah: 1, ayah: 2, word: 2, symbol: 1 } },
  ];
  spanningAyat.words = [{
    ...spanningAyat.words[0]!,
    symbolIds: ['s:1:1:1:1', 's:1:1:2:1'],
  }, spanningAyat.words[1]!];
  assert.throws(() => validateCorpus(spanningAyat), /ayat/i);
});

test('rejects unsafe producer observations', () => {
  assert.doesNotThrow(() => validateObservation(observation()));
  assert.throws(() => validateObservation(observation({
    tokens: [{ ...observation().tokens[0]!, confidence: Number.NaN }],
  })), /confidence/i);
  assert.throws(() => validateObservation(observation({
    tokens: [{ ...observation().tokens[0]!, confidence: -0.01 }],
  })), /confidence/i);
  assert.throws(() => validateObservation(observation({
    tokens: [{ ...observation().tokens[0]!, confidence: 1.01 }],
  })), /confidence/i);
  assert.throws(() => validateObservation(observation({
    tokens: [
      { ...observation().tokens[0]!, id: 'first', startMs: 10, endMs: 20 },
      { ...observation().tokens[0]!, id: 'second', startMs: 5, endMs: 30 },
    ],
  })), /timestamp/i);
  assert.throws(() => validateObservation(observation({
    tokens: [observation().tokens[0]!, observation().tokens[0]!],
  })), /duplicate token id/i);
  assert.throws(() => validateObservation(observation({ sourceRevision: -1 })), /source revision/i);
  assert.throws(() => validateObservation(observation({ tokens: [] })), /partial observation/i);
});

test('accepts the aggregate phoneme boundary and rejects every observation resource ceiling above it', () => {
  assert.doesNotThrow(() => validateObservation(observation({
    tokens: [{
      id: 'boundary-token',
      text: 'boundary',
      phonemes: Array.from({ length: 128 }, () => 'p'),
    }],
  })));
  assert.throws(() => validateObservation(observation({
    tokens: [{
      id: 'oversized-phonemes',
      text: 'oversized',
      phonemes: Array.from({ length: 129 }, () => 'p'),
    }],
  })), /128 phonemes/i);
  assert.throws(() => validateObservation(observation({
    tokens: Array.from({ length: 65 }, (_, index) => ({
      id: `token-${index}`,
      text: 'p',
      phonemes: ['p'],
    })),
  })), /64 tokens/i);
  assert.throws(() => validateObservation(observation({
    observationId: 'o'.repeat(257),
  })), /observation id.*256/i);
  assert.throws(() => validateObservation(observation({
    tokens: [{ id: 't'.repeat(257), text: 'p', phonemes: ['p'] }],
  })), /token id.*256/i);
  assert.throws(() => validateObservation(observation({
    tokens: [{ id: 'long-text', text: 't'.repeat(1_025), phonemes: ['p'] }],
  })), /token text.*1024/i);
  assert.throws(() => validateObservation(observation({
    tokens: [{ id: 'long-phoneme', text: 'p', phonemes: ['p'.repeat(129)] }],
  })), /phoneme.*128/i);
});
