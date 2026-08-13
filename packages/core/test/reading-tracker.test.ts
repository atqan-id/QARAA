import assert from 'node:assert/strict';
import test from 'node:test';

import {
  trackerCorpus,
  trackerObservation,
} from '../../../fixtures/regressions/tracker-cases.ts';
import {
  classifyFinding,
  createReadingTracker,
  indexCorpus,
  passesSoftFindingGate,
} from '../src/index.ts';
import {
  classifyFindingWithEvidence,
  deriveSubstitutionEvidence,
} from '../src/findings/classify.ts';
import {
  advanceProvisionalFinding,
  collectTouchedWordIds,
  countFindingContextPhonemes,
} from '../src/tracking/reading-tracker.ts';
import type {
  AlignmentCandidate,
  AlignmentMetricsSink,
  AlignmentOperation,
  ConfidenceEvidence,
  QuranCorpus,
} from '../src/index.ts';

const ayahTwoStart = { surah: 1, ayah: 2, word: 1, symbol: 1 } as const;

function tracker(findingMode: 'off' | 'substitutions' = 'substitutions') {
  return createReadingTracker({
    corpus: indexCorpus(trackerCorpus),
    initialLocation: ayahTwoStart,
    findingMode,
  });
}

function syntheticCorpus(symbolCount: number): QuranCorpus {
  return {
    corpusId: 'synthetic-operation-count',
    revision: '1',
    symbols: Array.from({ length: symbolCount }, (_, index) => ({
      id: `synthetic-symbol-${index}`,
      text: `S${index}`,
      phoneme: `p${index % 97}`,
      location: { surah: 1, ayah: 1, word: index + 1, symbol: 1 },
    })),
    words: Array.from({ length: symbolCount }, (_, index) => ({
      id: `synthetic-word-${index}`,
      text: `W${index}`,
      symbolIds: [`synthetic-symbol-${index}`],
      location: { surah: 1, ayah: 1, word: index + 1 },
    })),
  };
}

function findingContext(before: number, after: number): readonly AlignmentOperation[] {
  const operations: AlignmentOperation[] = [];
  for (let index = 0; index < before; index += 1) {
    operations.push({ kind: 'match', actualIndex: index, referenceIndex: index, score: 1 });
  }
  operations.push({
    kind: 'substitution',
    actualIndex: before,
    referenceIndex: before,
    score: 0,
  });
  for (let index = 0; index < after; index += 1) {
    operations.push({
      kind: 'match',
      actualIndex: before + index + 1,
      referenceIndex: before + index + 1,
      score: 1,
    });
  }
  return operations;
}

function softCandidate(contextPhonemeCount: 2 | 3): AlignmentCandidate {
  return {
    symbolIndex: 6,
    location: ayahTwoStart,
    alignment: {
      score: 0.9,
      editCount: 2,
      matchedLookaheadCount: contextPhonemeCount,
      operations: [
        { kind: 'substitution', actualIndex: 0, referenceIndex: 0, score: 0 },
        ...Array.from({ length: contextPhonemeCount }, (_, offset) => ({
          kind: 'match' as const,
          actualIndex: offset + 1,
          referenceIndex: offset + 1,
          score: 1,
        })),
        {
          kind: 'insertion',
          actualIndex: contextPhonemeCount + 1,
          referenceIndex: null,
          score: 0,
        },
      ],
    },
    score: 0.9,
    scoreMargin: 0.1,
    cursorDistance: 0,
    continuity: 0,
    forwardMovement: 0,
    isReread: false,
  };
}

function softConfidence(lookahead: number, matchedLookaheadCount: number, combined: number): ConfidenceEvidence {
  return {
    alignment: 0.9,
    stability: 1,
    lookahead,
    matchedLookaheadCount,
    margin: 0.1,
    acoustic: 1,
    combined,
  };
}

function confirmSoftContext(contextPhonemeCount: 2 | 3) {
  const corpus = indexCorpus(trackerCorpus);
  const candidate = softCandidate(contextPhonemeCount);
  const originalConfidence = softConfidence(1, contextPhonemeCount, 0.89);
  const evidence = deriveSubstitutionEvidence(candidate, originalConfidence);
  assert.ok(evidence);
  const actualPhonemes = [
    'wrong',
    ...Array.from({ length: contextPhonemeCount }, (_, offset) => `q${offset + 2}`),
    'extra',
  ];
  const fingerprint = `soft-context-${contextPhonemeCount}`;
  const firstState = advanceProvisionalFinding(
    null,
    fingerprint,
    evidence,
    contextPhonemeCount,
  );
  assert.ok(firstState);
  const first = classifyFindingWithEvidence({
    corpus,
    candidate,
    observation: trackerObservation(`${fingerprint}-1`, 1, actualPhonemes),
    actualPhonemes,
    confidence: originalConfidence,
    confirmations: firstState.confirmations,
    contextPhonemeCount,
  }, evidence);
  const secondState = advanceProvisionalFinding(
    firstState,
    fingerprint,
    evidence,
    contextPhonemeCount,
  );
  assert.ok(secondState);
  const second = classifyFindingWithEvidence({
    corpus,
    candidate,
    observation: trackerObservation(`${fingerprint}-2`, 2, actualPhonemes),
    actualPhonemes,
    confidence: originalConfidence,
    confirmations: secondState.confirmations,
    contextPhonemeCount,
  }, evidence);
  return { first, second };
}

test('increments once per accepted observation and returns the current snapshot for duplicates or stale revisions', () => {
  const readingTracker = tracker();
  const accepted = readingTracker.submit(trackerObservation('accepted', 2, ['q1', 'q2', 'q3', 'q4']));

  assert.equal(accepted.revision, 1);
  assert.equal(accepted.observationId, 'accepted');
  assert.strictEqual(
    readingTracker.submit(trackerObservation('accepted', 3, ['p1', 'p2', 'p3', 'p4'])),
    accepted,
  );
  assert.strictEqual(
    readingTracker.submit(trackerObservation('delayed', 1, ['p1', 'p2', 'p3', 'p4'])),
    accepted,
  );
});

test('uses two prior hypothesis fingerprints as bounded stability evidence', () => {
  const readingTracker = tracker('off');

  assert.equal(readingTracker.submit(trackerObservation('stable-1', 1, ['q1', 'q2', 'q3', 'q4'])).confidence?.stability, 0);
  assert.equal(readingTracker.submit(trackerObservation('stable-2', 2, ['q1', 'q2', 'q3', 'q4'])).confidence?.stability, 0.5);
  assert.equal(readingTracker.submit(trackerObservation('stable-3', 3, ['q1', 'q2', 'q3', 'q4'])).confidence?.stability, 1);
});

test('allows a one-ayah reread on display without moving committed progress backward', () => {
  const readingTracker = tracker('off');
  const snapshot = readingTracker.submit(trackerObservation('reread', 1, ['p1', 'p2', 'p3', 'p4']));

  assert.deepEqual(snapshot.display.location, { surah: 1, ayah: 1, word: 4, symbol: 1 });
  assert.equal(snapshot.display.activeWordId, 'w:1:1:4');
  assert.equal(snapshot.display.isReread, true);
  assert.deepEqual(snapshot.commit.location, ayahTwoStart);
  assert.deepEqual(snapshot.commit.completedWordIds, []);
});

test('suppresses a stable high-confidence final substitution while rereading backward', () => {
  const readingTracker = tracker();
  readingTracker.submit(trackerObservation(
    'reread-context-1',
    1,
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
  ));
  readingTracker.submit(trackerObservation(
    'reread-context-2',
    2,
    ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
  ));
  const snapshot = readingTracker.submit(trackerObservation(
    'reread-final-substitution',
    3,
    ['p1', 'wrong', 'p3', 'p4', 'p5', 'p6'],
    { isFinal: true, confidence: 1 },
  ));

  assert.equal(snapshot.display.isReread, true);
  assert.deepEqual(snapshot.commit.location, ayahTwoStart);
  assert.equal(snapshot.confidence?.stability, 1);
  assert.equal(snapshot.finding, null);
});

test('does not commit a partial word boundary without two matching lookahead phonemes', () => {
  const readingTracker = tracker('off');
  const snapshot = readingTracker.submit(trackerObservation('short-partial', 1, ['q1', 'q2']));

  assert.deepEqual(snapshot.commit.completedWordIds, []);
  assert.deepEqual(snapshot.commit.location, ayahTwoStart);
});

test('commits an exact final one-symbol word at the corpus edge using location margin', () => {
  const readingTracker = createReadingTracker({
    corpus: indexCorpus(trackerCorpus),
    initialLocation: { surah: 1, ayah: 3, word: 7, symbol: 1 },
    findingMode: 'off',
  });
  const snapshot = readingTracker.submit(trackerObservation('last-word', 1, ['r7'], { isFinal: true }));

  assert.equal(snapshot.confidence?.alignment, 1);
  assert.equal(snapshot.confidence?.margin, 0.5);
  assert.deepEqual(snapshot.commit.completedWordIds, ['w:1:3:7']);
  assert.deepEqual(snapshot.commit.location, { surah: 1, ayah: 3, word: 7, symbol: 1 });
});

test('commits every completed word supported by lookahead in one fast chunk', () => {
  const readingTracker = tracker('off');
  const snapshot = readingTracker.submit(trackerObservation(
    'fast-chunk',
    1,
    ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'],
  ));

  assert.deepEqual(snapshot.display.location, { surah: 1, ayah: 2, word: 6, symbol: 1 });
  assert.deepEqual(snapshot.commit.completedWordIds, [
    'w:1:2:1',
    'w:1:2:2',
    'w:1:2:3',
    'w:1:2:4',
  ]);
  assert.deepEqual(snapshot.commit.location, { surah: 1, ayah: 2, word: 4, symbol: 1 });
});

test('measures bounded candidate and edit-cell work without changing tracker snapshots', () => {
  const corpus = indexCorpus(syntheticCorpus(4_096));
  const initialLocation = corpus.symbols[2_000]!.location;
  const actualPhonemes = corpus.symbols
    .slice(2_000, 2_020)
    .map(({ phoneme }) => phoneme);
  const metrics = {
    candidateEvaluations: 0,
    editCells: 0,
    corpusSymbolIndexes: new Set<number>(),
  };
  const metricsSink: AlignmentMetricsSink = {
    recordCandidateEvaluation(symbolIndex) {
      metrics.candidateEvaluations += 1;
      metrics.corpusSymbolIndexes.add(symbolIndex);
    },
    recordEditCell() {
      metrics.editCells += 1;
    },
    recordCorpusSymbolAccess(symbolIndex) {
      metrics.corpusSymbolIndexes.add(symbolIndex);
    },
  };
  const measuredTracker = createReadingTracker({
    corpus,
    initialLocation,
    findingMode: 'off',
    metricsSink,
  });
  const unmeasuredTracker = createReadingTracker({
    corpus,
    initialLocation,
    findingMode: 'off',
  });
  const observation = {
    observationId: 'bounded-fast-chunk',
    sourceRevision: 1,
    isFinal: false,
    receivedAtMs: 10,
    tokens: actualPhonemes.map((phoneme, index) => ({
      id: `bounded-fast-token-${index}`,
      text: phoneme,
      phonemes: [phoneme],
      startMs: index,
      endMs: index + 1,
      confidence: 1,
    })),
  };

  const measuredSnapshot = measuredTracker.submit(observation);
  const unmeasuredSnapshot = unmeasuredTracker.submit(observation);

  assert.deepEqual(measuredSnapshot, unmeasuredSnapshot);
  assert.ok(metrics.candidateEvaluations > 0);
  assert.ok(metrics.candidateEvaluations <= 64);
  assert.equal(metrics.editCells, metrics.candidateEvaluations * 2_800);
  assert.ok(metrics.corpusSymbolIndexes.size < corpus.symbols.length);
});

test('collects commit words with work bounded by candidate references and two lookahead positions', () => {
  let indexedReads = 0;
  const wordIds = new Proxy(new Array<string | null>(100_000).fill(null), {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) indexedReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  wordIds[50_000] = 'word-a';
  wordIds[50_001] = 'word-b';
  wordIds[50_002] = 'word-c';
  wordIds[50_003] = 'word-d';
  indexedReads = 0;
  const candidate: AlignmentCandidate = {
    symbolIndex: 50_000,
    location: { surah: 1, ayah: 1, word: 1, symbol: 1 },
    alignment: {
      score: 1,
      editCount: 0,
      matchedLookaheadCount: 0,
      operations: [
        { kind: 'match', actualIndex: 0, referenceIndex: 0, score: 1 },
        { kind: 'match', actualIndex: 1, referenceIndex: 1, score: 1 },
      ],
    },
    score: 1,
    scoreMargin: 1,
    cursorDistance: 0,
    continuity: 1,
    forwardMovement: 0,
    isReread: false,
  };

  assert.deepEqual(collectTouchedWordIds(candidate, wordIds), [
    'word-a',
    'word-b',
    'word-c',
    'word-d',
  ]);
  assert.equal(indexedReads, 4);
});

test('does not label an extended streaming hypothesis as a reread when its display advances', () => {
  const readingTracker = tracker('off');
  readingTracker.submit(trackerObservation(
    'streaming-prefix',
    1,
    ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'],
  ));
  const extended = readingTracker.submit(trackerObservation(
    'streaming-extended',
    2,
    ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'],
  ));

  assert.deepEqual(extended.display.location, { surah: 1, ayah: 2, word: 8, symbol: 1 });
  assert.equal(extended.display.isReread, false);
});

test('prevents a delayed observation from overwriting a newer display snapshot', () => {
  const readingTracker = tracker('off');
  const newer = readingTracker.submit(trackerObservation('newer', 4, ['q3', 'q4', 'q5', 'q6']));
  const delayed = readingTracker.submit(trackerObservation('older-computation', 3, ['p1', 'p2', 'p3', 'p4']));

  assert.strictEqual(delayed, newer);
  assert.equal(delayed.revision, 1);
  assert.deepEqual(delayed.display.location, { surah: 1, ayah: 2, word: 6, symbol: 1 });
});

test('keeps exactly 512 observation IDs for idempotency', () => {
  const readingTracker = tracker('off');
  for (let index = 0; index < 512; index += 1) {
    readingTracker.submit(trackerObservation(`cache-${index}`, index + 1, ['q1', 'q2', 'q3', 'q4']));
  }

  const atCapacity = readingTracker.getSnapshot();
  assert.equal(atCapacity.revision, 512);
  assert.strictEqual(
    readingTracker.submit(trackerObservation('cache-0', 513, ['q1', 'q2', 'q3', 'q4'])),
    atCapacity,
  );

  assert.equal(
    readingTracker.submit(trackerObservation('cache-512', 513, ['q1', 'q2', 'q3', 'q4'])).revision,
    513,
  );
  assert.equal(
    readingTracker.submit(trackerObservation('cache-0', 514, ['q1', 'q2', 'q3', 'q4'])).revision,
    514,
  );
});

test('keeps a hard substitution provisional when its raw weighted score is below the immediate gate', () => {
  const readingTracker = tracker();
  readingTracker.submit(trackerObservation('hard-context-1', 1, ['q1', 'q2', 'q3', 'q4']));
  readingTracker.submit(trackerObservation('hard-context-2', 2, ['q1', 'q2', 'q3', 'q4']));
  const snapshot = readingTracker.submit(trackerObservation(
    'hard-substitution',
    3,
    ['q1', 'wrong', 'q3', 'q4'],
  ));

  assert.equal(snapshot.confidence?.combined < 0.9, true);
  assert.equal(snapshot.finding, null);
});

test('confirms ambiguous final substitution evidence at its lower final gate', () => {
  const symbols = Array.from({ length: 7 }, (_, index) => ({
    id: `final-symbol-${index}`,
    text: `q${index + 1}`,
    phoneme: `q${index + 1}`,
    location: { surah: 1, ayah: 1, word: 1, symbol: index + 1 },
  }));
  const readingTracker = createReadingTracker({
    corpus: indexCorpus({
      corpusId: 'final-finding-corpus',
      revision: '1',
      symbols,
      words: [{
        id: 'final-word',
        text: 'q1 q2 q3 q4 q5 q6 q7',
        symbolIds: symbols.map(({ id }) => id),
        location: { surah: 1, ayah: 1, word: 1 },
      }],
    }),
  });
  readingTracker.submit(trackerObservation('final-context-1', 1, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']));
  readingTracker.submit(trackerObservation('final-context-2', 2, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']));
  const snapshot = readingTracker.submit(trackerObservation(
    'final-substitution',
    3,
    ['q1', 'wrong', 'q3', 'q4', 'q5', 'q6', 'q7'],
    { isFinal: true },
  ));

  assert.equal(snapshot.finding?.confirmation, 'final');
  assert.equal(snapshot.finding?.confidence.combined >= 0.82, true);
  assert.equal(snapshot.finding?.confidence.margin >= 0.1, true);
});

test('does not construct a finding when its aligned position is below the display gate', () => {
  const corpus = indexCorpus(trackerCorpus);
  const operation = Object.freeze({
    kind: 'substitution' as const,
    actualIndex: 0,
    referenceIndex: 0,
    score: 0,
  });
  const candidate: AlignmentCandidate = {
    symbolIndex: 6,
    location: ayahTwoStart,
    alignment: {
      score: 0.7,
      editCount: 1,
      matchedLookaheadCount: 2,
      operations: [
        operation,
        { kind: 'match', actualIndex: 1, referenceIndex: 1, score: 1 },
        { kind: 'match', actualIndex: 2, referenceIndex: 2, score: 1 },
      ],
    },
    score: 0.7,
    scoreMargin: 0.1,
    cursorDistance: 0,
    continuity: 0,
    forwardMovement: 0,
    isReread: false,
  };
  const confidence: ConfidenceEvidence = {
    alignment: 0.7,
    stability: 1,
    lookahead: 1,
    matchedLookaheadCount: 2,
    margin: 0.1,
    acoustic: 1,
    combined: 0.82,
  };

  assert.equal(classifyFinding({
    corpus,
    candidate,
    observation: trackerObservation('unlocated-final', 1, ['wrong', 'q2', 'q3'], { isFinal: true }),
    actualPhonemes: ['wrong', 'q2', 'q3'],
    confidence,
    confirmations: 1,
    contextPhonemeCount: 2,
  }), null);
});

test('does not reuse lookahead from a leading edit for a terminal substitution', () => {
  const corpus = indexCorpus(trackerCorpus);
  const candidate: AlignmentCandidate = {
    symbolIndex: 6,
    location: ayahTwoStart,
    alignment: {
      score: 0.8,
      editCount: 2,
      matchedLookaheadCount: 2,
      operations: [
        { kind: 'insertion', actualIndex: 0, referenceIndex: null, score: 0 },
        { kind: 'match', actualIndex: 1, referenceIndex: 0, score: 1 },
        { kind: 'match', actualIndex: 2, referenceIndex: 1, score: 1 },
        { kind: 'substitution', actualIndex: 3, referenceIndex: 2, score: 0 },
      ],
    },
    score: 0.8,
    scoreMargin: 0.15,
    cursorDistance: 0,
    continuity: 0,
    forwardMovement: 0,
    isReread: false,
  };
  const confidence: ConfidenceEvidence = {
    alignment: 0.8,
    stability: 1,
    lookahead: 1,
    matchedLookaheadCount: 2,
    margin: 0.15,
    acoustic: 1,
    combined: 0.932,
  };

  assert.equal(classifyFinding({
    corpus,
    candidate,
    observation: trackerObservation('terminal-substitution', 1, ['extra', 'q1', 'q2', 'wrong']),
    actualPhonemes: ['extra', 'q1', 'q2', 'wrong'],
    confidence,
    confirmations: 1,
    contextPhonemeCount: 2,
  }), null);
});

test('public classifier rejects injected evidence for a terminal substitution', () => {
  const corpus = indexCorpus(trackerCorpus);
  const operation = {
    kind: 'substitution' as const,
    actualIndex: 3,
    referenceIndex: 2,
    score: 0,
  };
  const candidate: AlignmentCandidate = {
    symbolIndex: 6,
    location: ayahTwoStart,
    alignment: {
      score: 0.8,
      editCount: 2,
      matchedLookaheadCount: 2,
      operations: [
        { kind: 'insertion', actualIndex: 0, referenceIndex: null, score: 0 },
        { kind: 'match', actualIndex: 1, referenceIndex: 0, score: 1 },
        { kind: 'match', actualIndex: 2, referenceIndex: 1, score: 1 },
        operation,
      ],
    },
    score: 0.8,
    scoreMargin: 0.15,
    cursorDistance: 0,
    continuity: 0,
    forwardMovement: 0,
    isReread: false,
  };
  const confidence: ConfidenceEvidence = {
    alignment: 0.8,
    stability: 1,
    lookahead: 1,
    matchedLookaheadCount: 2,
    margin: 0.15,
    acoustic: 1,
    combined: 0.932,
  };
  const forgedInput = {
    corpus,
    candidate,
    observation: trackerObservation('forged-terminal', 1, ['extra', 'q1', 'q2', 'wrong']),
    actualPhonemes: ['extra', 'q1', 'q2', 'wrong'],
    confidence,
    substitutionEvidence: { operation, confidence },
    confirmations: 1,
    contextPhonemeCount: 2,
  };

  assert.equal(classifyFinding(forgedInput), null);
});

test('copies and freezes classifier operation and confidence inputs', () => {
  const corpus = indexCorpus(trackerCorpus);
  const operation = {
    kind: 'substitution' as const,
    actualIndex: 0,
    referenceIndex: 0,
    score: 0,
  };
  const confidence: ConfidenceEvidence = {
    alignment: 1,
    stability: 1,
    lookahead: 1,
    matchedLookaheadCount: 2,
    margin: 1,
    acoustic: 1,
    combined: 1,
  };
  const candidate: AlignmentCandidate = {
    symbolIndex: 6,
    location: ayahTwoStart,
    alignment: {
      score: 2 / 3,
      editCount: 1,
      matchedLookaheadCount: 2,
      operations: [
        operation,
        { kind: 'match', actualIndex: 1, referenceIndex: 1, score: 1 },
        { kind: 'match', actualIndex: 2, referenceIndex: 2, score: 1 },
      ],
    },
    score: 2 / 3,
    scoreMargin: 1,
    cursorDistance: 0,
    continuity: 0,
    forwardMovement: 0,
    isReread: false,
  };
  const finding = classifyFinding({
    corpus,
    candidate,
    observation: trackerObservation('immutable-finding', 1, ['wrong', 'q2', 'q3']),
    actualPhonemes: ['wrong', 'q2', 'q3'],
    confidence,
    confirmations: 1,
    contextPhonemeCount: 2,
  });
  assert.ok(finding);
  assert.equal(finding.confirmation, 'immediate');

  Object.assign(operation, { actualIndex: 2 });
  Object.assign(confidence, { combined: 0 });

  assert.equal(finding.operation.actualIndex, 0);
  assert.equal(finding.confidence.combined, 1);
  assert.equal(Object.isFrozen(finding.operation), true);
  assert.equal(Object.isFrozen(finding.confidence), true);
  assert.throws(() => Object.assign(finding.operation, { actualIndex: 1 }), TypeError);
  assert.throws(() => Object.assign(finding.confidence, { combined: 0 }), TypeError);
});

test('preserves a four-plus context sentinel so only two or three phonemes pass the soft gate', () => {
  const confidence: ConfidenceEvidence = {
    alignment: 1,
    stability: 1,
    lookahead: 1,
    matchedLookaheadCount: 2,
    margin: 1,
    acoustic: null,
    combined: 0.88,
  };
  const two = findingContext(1, 1);
  const three = findingContext(1, 2);
  const four = findingContext(1, 3);

  assert.equal(countFindingContextPhonemes(two, two[1]!), 2);
  assert.equal(countFindingContextPhonemes(three, three[1]!), 3);
  assert.equal(countFindingContextPhonemes(four, four[1]!), 4);
  assert.equal(passesSoftFindingGate(confidence, 2, countFindingContextPhonemes(two, two[1]!)), true);
  assert.equal(passesSoftFindingGate(confidence, 2, countFindingContextPhonemes(three, three[1]!)), true);
  assert.equal(passesSoftFindingGate(confidence, 2, countFindingContextPhonemes(four, four[1]!)), false);
});

test('tracker confirms a soft finding after two eligible two-context observations', () => {
  const { first, second } = confirmSoftContext(2);

  assert.equal(first, null);
  assert.equal(second?.confirmation, 'soft');
  assert.equal(second?.confirmations, 2);
});

test('tracker confirms a soft finding after two eligible three-context observations', () => {
  const { first, second } = confirmSoftContext(3);

  assert.equal(first, null);
  assert.equal(second?.confirmation, 'soft');
  assert.equal(second?.confirmations, 2);
});

test('tracker provisional eligibility follows substitution-adjusted threshold crossings in both directions', () => {
  const crossingCandidate: AlignmentCandidate = {
    ...softCandidate(2),
    alignment: {
      score: 0.9,
      editCount: 2,
      matchedLookaheadCount: 0,
      operations: [
        { kind: 'insertion', actualIndex: 0, referenceIndex: null, score: 0 },
        { kind: 'substitution', actualIndex: 1, referenceIndex: 0, score: 0 },
        { kind: 'match', actualIndex: 2, referenceIndex: 1, score: 1 },
        { kind: 'match', actualIndex: 3, referenceIndex: 2, score: 1 },
      ],
    },
  };
  const crossingOriginal = softConfidence(0, 0, 0.72);
  const crossingEvidence = deriveSubstitutionEvidence(crossingCandidate, crossingOriginal);
  assert.ok(crossingEvidence);
  assert.equal(passesSoftFindingGate(crossingOriginal, 2, 2), false);
  assert.equal(passesSoftFindingGate(crossingEvidence.confidence, 2, 2), true);
  const crossingFirst = advanceProvisionalFinding(null, 'crossing', crossingEvidence, 2);
  assert.equal(crossingFirst?.confirmations, 1);
  const crossingSecond = advanceProvisionalFinding(
    crossingFirst,
    'crossing',
    crossingEvidence,
    2,
  );
  assert.equal(classifyFindingWithEvidence({
    corpus: indexCorpus(trackerCorpus),
    candidate: crossingCandidate,
    observation: trackerObservation('crossing', 1, ['extra', 'wrong', 'q2', 'q3']),
    actualPhonemes: ['extra', 'wrong', 'q2', 'q3'],
    confidence: crossingOriginal,
    confirmations: crossingSecond?.confirmations ?? 0,
    contextPhonemeCount: 2,
  }, crossingEvidence)?.confirmation, 'soft');

  const rejectedCandidate: AlignmentCandidate = {
    ...softCandidate(2),
    alignment: {
      score: 0.9,
      editCount: 2,
      matchedLookaheadCount: 2,
      operations: [
        { kind: 'insertion', actualIndex: 0, referenceIndex: null, score: 0 },
        { kind: 'match', actualIndex: 1, referenceIndex: 0, score: 1 },
        { kind: 'match', actualIndex: 2, referenceIndex: 1, score: 1 },
        { kind: 'substitution', actualIndex: 3, referenceIndex: 2, score: 0 },
      ],
    },
  };
  const rejectedOriginal = softConfidence(1, 2, 0.89);
  const rejectedEvidence = deriveSubstitutionEvidence(rejectedCandidate, rejectedOriginal);
  assert.ok(rejectedEvidence);
  assert.equal(passesSoftFindingGate(rejectedOriginal, 2, 2), true);
  assert.equal(passesSoftFindingGate(rejectedEvidence.confidence, 2, 2), false);
  assert.equal(advanceProvisionalFinding(null, 'rejected', rejectedEvidence, 2), null);
  assert.equal(classifyFindingWithEvidence({
    corpus: indexCorpus(trackerCorpus),
    candidate: rejectedCandidate,
    observation: trackerObservation('rejected', 1, ['extra', 'q1', 'q2', 'wrong']),
    actualPhonemes: ['extra', 'q1', 'q2', 'wrong'],
    confidence: rejectedOriginal,
    confirmations: 2,
    contextPhonemeCount: 2,
  }, rejectedEvidence), null);
});

test('does not confirm two matching provisional candidates with four-plus context', () => {
  const readingTracker = tracker();
  readingTracker.submit(trackerObservation('soft-context-1', 1, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']));
  readingTracker.submit(trackerObservation('soft-context-2', 2, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7']));
  const first = readingTracker.submit(trackerObservation(
    'soft-substitution-1',
    3,
    ['q1', 'wrong', 'q3', 'q4', 'q5', 'q6', 'q7'],
  ));
  const second = readingTracker.submit(trackerObservation(
    'soft-substitution-2',
    4,
    ['q1', 'wrong', 'q3', 'q4', 'q5', 'q6', 'q7'],
  ));

  assert.equal(first.finding, null);
  assert.equal(second.finding, null);
});

test('reset is synchronous and invalidates the prior snapshot without retaining observation IDs', () => {
  const readingTracker = tracker('off');
  const accepted = readingTracker.submit(trackerObservation('before-reset', 1, ['q1', 'q2', 'q3', 'q4']));
  const reset = readingTracker.reset({ surah: 1, ayah: 3, word: 1, symbol: 1 });

  assert.equal(reset.revision, accepted.revision + 1);
  assert.equal(reset.observationId, null);
  assert.deepEqual(reset.display.location, { surah: 1, ayah: 3, word: 1, symbol: 1 });
  assert.deepEqual(reset.commit.completedWordIds, []);
  assert.equal(readingTracker.submit(trackerObservation('before-reset', 0, ['r1', 'r2', 'r3', 'r4'])).revision, reset.revision + 1);
});
