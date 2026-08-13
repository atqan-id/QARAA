import assert from 'node:assert/strict';
import test from 'node:test';

import {
  passesFinalFindingGate,
  passesImmediateFindingGate,
  passesPositionGate,
  passesSoftFindingGate,
  scoreConfidence,
} from '../src/index.ts';
import type { ConfidenceEvidence } from '../src/index.ts';

function evidence(overrides: Partial<ConfidenceEvidence> = {}): ConfidenceEvidence {
  return {
    alignment: 1,
    stability: 1,
    lookahead: 1,
    matchedLookaheadCount: 3,
    margin: 1,
    acoustic: null,
    combined: 1,
    ...overrides,
  };
}

test('weights alignment, stability, lookahead, and margin without acoustic evidence', () => {
  const result = scoreConfidence({
    alignment: 0.8,
    stability: 0.6,
    matchedLookaheadCount: 1,
    margin: 0.1,
    actualPhonemeCount: 2,
  });

  assert.equal(result.lookahead, 0.5);
  assert.equal(result.acoustic, null);
  assert.equal(result.combined, 0.5850000000000001);
});

test('gives valid aligned acoustic confidence fifteen percent of the score', () => {
  const result = scoreConfidence({
    alignment: 0.8,
    stability: 0.6,
    matchedLookaheadCount: 1,
    margin: 0.1,
    actualPhonemeCount: 2,
    acousticConfidences: [0.7, 0.9],
  });

  assert.equal(result.acoustic, 0.8);
  assert.equal(
    result.combined,
    0.6172500000000001,
  );
});

test('weights the raw clamped margin and crosses the acoustic final gate only at the exact score', () => {
  const below = scoreConfidence({
    alignment: 0.8,
    stability: 1,
    matchedLookaheadCount: 2,
    margin: 0.1,
    actualPhonemeCount: 5,
    acousticConfidences: [1, 1, 1, 1, 1],
  });
  const atGate = scoreConfidence({
    alignment: 0.82,
    stability: 1,
    matchedLookaheadCount: 2,
    margin: 0.1,
    actualPhonemeCount: 5,
    acousticConfidences: [1, 1, 1, 1, 1],
  });

  assert.equal(below.margin, 0.1);
  assert.equal(below.combined, 0.8172500000000001);
  assert.equal(passesFinalFindingGate(below), false);
  assert.equal(atGate.combined, 0.8240500000000001);
  assert.equal(passesFinalFindingGate(atGate), true);
});

test('ignores invalid or misaligned acoustic evidence instead of poisoning confidence', () => {
  const baseline = scoreConfidence({
    alignment: 0.8,
    stability: 0.6,
    matchedLookaheadCount: 1,
    margin: 0.1,
    actualPhonemeCount: 2,
  });
  const invalid = scoreConfidence({
    alignment: 0.8,
    stability: 0.6,
    matchedLookaheadCount: 1,
    margin: 0.1,
    actualPhonemeCount: 2,
    acousticConfidences: [Number.NaN, 1.1],
  });
  const misaligned = scoreConfidence({
    alignment: 0.8,
    stability: 0.6,
    matchedLookaheadCount: 1,
    margin: 0.1,
    actualPhonemeCount: 2,
    acousticConfidences: [0.9],
  });

  assert.deepEqual(invalid, baseline);
  assert.deepEqual(misaligned, baseline);
});

test('requires both alignment and margin at the inclusive position thresholds', () => {
  assert.equal(passesPositionGate(evidence({ alignment: 0.72, margin: 0.08 })), true);
  assert.equal(passesPositionGate(evidence({ alignment: 0.719, margin: 0.08 })), false);
  assert.equal(passesPositionGate(evidence({ alignment: 0.72, margin: 0.079 })), false);
});

test('requires strong confidence, margin, and two matching lookahead phonemes for an immediate finding', () => {
  assert.equal(passesImmediateFindingGate(evidence({
    combined: 0.9,
    margin: 0.15,
    matchedLookaheadCount: 2,
  })), true);
  assert.equal(passesImmediateFindingGate(evidence({ combined: 0.899 })), false);
  assert.equal(passesImmediateFindingGate(evidence({ margin: 0.149 })), false);
  assert.equal(passesImmediateFindingGate(evidence({ matchedLookaheadCount: 1 })), false);
});

test('uses the approved confidence and margin thresholds for final ambiguous evidence', () => {
  assert.equal(passesFinalFindingGate(evidence({ combined: 0.82, margin: 0.1 })), true);
  assert.equal(passesFinalFindingGate(evidence({ combined: 0.819 })), false);
  assert.equal(passesFinalFindingGate(evidence({ margin: 0.099 })), false);
});

test('requires two confirmations and two-to-three context phonemes for soft findings', () => {
  assert.equal(passesSoftFindingGate(evidence({ combined: 0.88 }), 2, 2), true);
  assert.equal(passesSoftFindingGate(evidence({ combined: 0.88 }), 2, 3), true);
  assert.equal(passesSoftFindingGate(evidence({ combined: 0.879 }), 2, 2), false);
  assert.equal(passesSoftFindingGate(evidence({ combined: 0.88 }), 1, 2), false);
  assert.equal(passesSoftFindingGate(evidence({ combined: 0.88 }), 2, 1), false);
  assert.equal(passesSoftFindingGate(evidence({ combined: 0.88 }), 2, 4), false);
});
