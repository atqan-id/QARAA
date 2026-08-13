import assert from 'node:assert/strict';
import test from 'node:test';

import { alignPhonemes } from '../src/index.ts';

test('keeps the final phoneme of خَتَمَ paired after leading deletions', () => {
  const alignment = alignPhonemes(['مَ'], ['خَ', 'تَ', 'مَ']);

  assert.deepEqual(alignment.operations, [
    { kind: 'deletion', actualIndex: null, referenceIndex: 0, score: 0 },
    { kind: 'deletion', actualIndex: null, referenceIndex: 1, score: 0 },
    { kind: 'match', actualIndex: 0, referenceIndex: 2, score: 1 },
  ]);
  assert.equal(alignment.operations.some((operation) => (
    operation.referenceIndex === 0 && operation.actualIndex === 0
  )), false);
});

test('does not pair لْ with وَ after omissions in وَٱلْفُلْكِ', () => {
  const alignment = alignPhonemes(['لْ', 'كِ'], ['وَ', 'ٱلْ', 'فُ', 'لْ', 'كِ']);

  const paired = alignment.operations.filter((operation) => (
    operation.actualIndex !== null && operation.referenceIndex !== null
  ));
  assert.deepEqual(paired, [
    { kind: 'match', actualIndex: 0, referenceIndex: 3, score: 1 },
    { kind: 'match', actualIndex: 1, referenceIndex: 4, score: 1 },
  ]);
  assert.equal(paired.some((operation) => (
    operation.referenceIndex === 0 && operation.actualIndex === 0
  )), false);
});

test('represents a substitution as one operation with both source positions', () => {
  const alignment = alignPhonemes(['خَ', 'طَ', 'مَ'], ['خَ', 'تَ', 'مَ']);

  assert.equal(alignment.editCount, 1);
  assert.equal(alignment.score, 2 / 3);
  assert.deepEqual(alignment.operations[1], {
    kind: 'substitution',
    actualIndex: 1,
    referenceIndex: 1,
    score: 0,
  });
});

test('breaks edit-path ties by match, substitution, deletion, then insertion', () => {
  const alignment = alignPhonemes(['a', 'b'], ['b', 'a']);

  assert.deepEqual(alignment.operations, [
    { kind: 'substitution', actualIndex: 0, referenceIndex: 0, score: 0 },
    { kind: 'substitution', actualIndex: 1, referenceIndex: 1, score: 0 },
  ]);
});

test('counts only contiguous matching lookahead after the first edit', () => {
  const alignment = alignPhonemes(['x', 'b', 'y', 'd'], ['a', 'b', 'c', 'd']);

  assert.equal(alignment.matchedLookaheadCount, 1);
});
