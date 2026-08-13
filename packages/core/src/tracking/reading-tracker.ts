/**
 * Sole synchronous state machine for display, commit, and finding progress.
 *
 * @license Apache-2.0
 */

import type { AlignmentCandidate, AlignmentOperation } from '../alignment/types.ts';
import { locateObservation } from '../alignment/locate.ts';
import {
  passesPositionGate,
  passesSoftFindingGate,
  scoreConfidence,
} from '../confidence/score.ts';
import type { ConfidenceEvidence } from '../confidence/types.ts';
import type { CorpusRange, IndexedCorpus, QuranLocation, QuranWord } from '../corpus/types.ts';
import { validateObservation } from '../corpus/validate.ts';
import {
  classifyFindingWithEvidence,
  deriveSubstitutionEvidence,
} from '../findings/classify.ts';
import type {
  ConfirmedFinding,
  SubstitutionEvidence,
  SubstitutionOperation,
} from '../findings/types.ts';
import type { RecitationObservation } from '../observation/types.ts';
import type {
  ReadingSnapshot,
  ReadingTracker,
  ReadingTrackerOptions,
} from './types.ts';

const OBSERVATION_ID_LIMIT = 512;
const STABILITY_HISTORY_LIMIT = 2;
const PARTIAL_COMMIT_LOOKAHEAD = 2;

type OrderedWord = Readonly<{
  word: QuranWord;
  range: CorpusRange;
}>;

type PreparedTrackerCorpus = Readonly<{
  words: readonly OrderedWord[];
  symbolWordIds: readonly (string | null)[];
  orderedWordsById: ReadonlyMap<string, OrderedWord>;
}>;

const preparedTrackerCorpora = new WeakMap<IndexedCorpus, PreparedTrackerCorpus>();

export type ProvisionalFinding = Readonly<{
  fingerprint: string;
  confirmations: number;
}>;

/** Advances the tracker's one bounded provisional candidate with selected evidence. */
export function advanceProvisionalFinding(
  previous: ProvisionalFinding | null,
  fingerprint: string,
  evidence: SubstitutionEvidence,
  contextPhonemeCount: number,
): ProvisionalFinding | null {
  if (!passesSoftFindingGate(evidence.confidence, 2, contextPhonemeCount)) return null;
  return Object.freeze({
    fingerprint,
    confirmations: previous?.fingerprint === fingerprint
      ? previous.confirmations + 1
      : 1,
  });
}

function sameLocation(left: QuranLocation, right: QuranLocation): boolean {
  return left.surah === right.surah
    && left.ayah === right.ayah
    && left.word === right.word
    && left.symbol === right.symbol;
}

function symbolIndexAt(corpus: IndexedCorpus, location: QuranLocation): number {
  const symbolIndex = corpus.symbols.findIndex((symbol) => sameLocation(symbol.location, location));
  if (symbolIndex < 0) throw new RangeError('reading tracker location is not present in the corpus');
  return symbolIndex;
}

function orderedWords(corpus: IndexedCorpus): readonly OrderedWord[] {
  return Object.freeze([...corpus.wordsById.values()]
    .map((word) => ({ word, range: corpus.wordSymbolRanges.get(word.id)! }))
    .sort((left, right) => left.range.start - right.range.start));
}

function wordIdsBySymbol(corpus: IndexedCorpus, words: readonly OrderedWord[]): readonly (string | null)[] {
  const result = new Array<string | null>(corpus.symbols.length).fill(null);
  for (const { word, range } of words) {
    for (let symbolIndex = range.start; symbolIndex < range.end; symbolIndex += 1) {
      result[symbolIndex] = word.id;
    }
  }
  return Object.freeze(result);
}

function prepareTrackerCorpus(corpus: IndexedCorpus): PreparedTrackerCorpus {
  const existing = preparedTrackerCorpora.get(corpus);
  if (existing) return existing;
  const words = orderedWords(corpus);
  const prepared = Object.freeze({
    words,
    symbolWordIds: wordIdsBySymbol(corpus, words),
    orderedWordsById: new Map(words.map((word) => [word.word.id, word])),
  });
  preparedTrackerCorpora.set(corpus, prepared);
  return prepared;
}

function observationPhonemes(observation: RecitationObservation): string[] {
  return observation.tokens.flatMap((token) => [...token.phonemes]);
}

function acousticConfidences(observation: RecitationObservation): (number | null)[] {
  return observation.tokens.flatMap((token) => (
    token.phonemes.map(() => token.confidence ?? null)
  ));
}

function activeReferenceOffset(candidate: AlignmentCandidate): number {
  let activeOffset = 0;
  for (const operation of candidate.alignment.operations) {
    if (operation.actualIndex !== null && operation.referenceIndex !== null) {
      activeOffset = Math.max(activeOffset, operation.referenceIndex);
    }
  }
  return activeOffset;
}

function hypothesisFingerprint(candidate: AlignmentCandidate): string {
  return `${candidate.symbolIndex}:${activeReferenceOffset(candidate)}`;
}

/** Returns only word IDs touched by aligned references and two following positions. */
export function collectTouchedWordIds(
  candidate: AlignmentCandidate,
  wordIdsBySymbol: readonly (string | null)[],
): readonly string[] {
  const touched = new Set<string>();
  let lastReferenceSymbol = -1;
  const addAt = (symbolIndex: number): void => {
    const wordId = wordIdsBySymbol[symbolIndex];
    if (wordId) touched.add(wordId);
  };

  for (const operation of candidate.alignment.operations) {
    if (operation.referenceIndex === null) continue;
    const symbolIndex = candidate.symbolIndex + operation.referenceIndex;
    addAt(symbolIndex);
    lastReferenceSymbol = Math.max(lastReferenceSymbol, symbolIndex);
  }
  if (lastReferenceSymbol >= 0) {
    for (let offset = 1; offset <= PARTIAL_COMMIT_LOOKAHEAD; offset += 1) {
      addAt(lastReferenceSymbol + offset);
    }
  }
  return Object.freeze([...touched]);
}

function stabilityFor(fingerprint: string, history: readonly string[]): number {
  let matches = 0;
  for (const previous of history) {
    if (previous === fingerprint) matches += 1;
  }
  return matches / STABILITY_HISTORY_LIMIT;
}

function locationScoreMargin(
  best: AlignmentCandidate,
  second: AlignmentCandidate | null,
): number {
  return Math.max(0, best.score - (second?.score ?? 0));
}

/** Counts adjacent finding context, preserving four as the overflow sentinel. */
export function countFindingContextPhonemes(
  operations: readonly AlignmentOperation[],
  substitution: SubstitutionOperation,
): number {
  const substitutionIndex = operations.findIndex((operation) => (
    operation.kind === 'substitution'
      && operation.actualIndex === substitution.actualIndex
      && operation.referenceIndex === substitution.referenceIndex
  ));
  if (substitutionIndex < 0) return 0;
  let matches = 0;
  for (let index = substitutionIndex - 1; index >= 0 && operations[index]!.kind === 'match'; index -= 1) {
    matches += 1;
    if (matches === 4) return matches;
  }
  for (let index = substitutionIndex + 1; index < operations.length && operations[index]!.kind === 'match'; index += 1) {
    matches += 1;
    if (matches === 4) return matches;
  }
  return matches;
}

function findingFingerprint(
  corpus: IndexedCorpus,
  candidate: AlignmentCandidate,
  operation: SubstitutionOperation,
  actualPhonemes: readonly string[],
): string | null {
  const reference = corpus.symbols[candidate.symbolIndex + operation.referenceIndex];
  const actual = actualPhonemes[operation.actualIndex];
  return reference && actual !== undefined ? `${reference.id}\u0000${actual}\u0000${reference.phoneme}` : null;
}

function freezeSnapshot(input: ReadingSnapshot): ReadingSnapshot {
  return Object.freeze({
    revision: input.revision,
    observationId: input.observationId,
    display: Object.freeze({
      location: Object.freeze({ ...input.display.location }),
      isReread: input.display.isReread,
      activeWordId: input.display.activeWordId,
    }),
    commit: Object.freeze({
      location: Object.freeze({ ...input.commit.location }),
      completedWordIds: Object.freeze([...input.commit.completedWordIds]),
    }),
    confidence: input.confidence,
    finding: input.finding,
  });
}

/** Creates a synchronous, bounded reading state machine for one indexed corpus. */
export function createReadingTracker(options: ReadingTrackerOptions): ReadingTracker {
  const { corpus } = options;
  if (corpus.symbols.length === 0) throw new TypeError('reading tracker requires a non-empty corpus');

  const { symbolWordIds, orderedWordsById } = prepareTrackerCorpus(corpus);
  const defaultInitialLocation = Object.freeze({
    ...(options.initialLocation ?? corpus.symbols[0]!.location),
  });
  const findingMode = options.findingMode ?? 'substitutions';
  if (findingMode !== 'off' && findingMode !== 'substitutions') {
    throw new TypeError('unsupported reading tracker finding mode');
  }

  let initialSymbol = symbolIndexAt(corpus, defaultInitialLocation);
  let cursorSymbol = initialSymbol;
  let committedSymbol = initialSymbol;
  let latestSourceRevision = -1;
  let observationIds = new Set<string>();
  let observationIdOrder: string[] = [];
  let hypothesisHistory: string[] = [];
  let provisionalFinding: ProvisionalFinding | null = null;
  let completedWordIds: string[] = [];
  let completedWordIdSet = new Set<string>();
  let snapshot = freezeSnapshot({
    revision: 0,
    observationId: null,
    display: {
      location: defaultInitialLocation,
      isReread: false,
      activeWordId: null,
    },
    commit: {
      location: defaultInitialLocation,
      completedWordIds,
    },
    confidence: null,
    finding: null,
  });

  const rememberObservationId = (observationId: string): void => {
    observationIds.add(observationId);
    observationIdOrder.push(observationId);
    if (observationIdOrder.length > OBSERVATION_ID_LIMIT) {
      observationIds.delete(observationIdOrder.shift()!);
    }
  };

  const rememberHypothesis = (fingerprint: string): void => {
    hypothesisHistory.push(fingerprint);
    if (hypothesisHistory.length > STABILITY_HISTORY_LIMIT) hypothesisHistory.shift();
  };

  const updateProvisionalFinding = (
    candidate: AlignmentCandidate,
    actualPhonemes: readonly string[],
    evidence: SubstitutionEvidence | null,
  ): Readonly<{ confirmations: number; context: number }> => {
    if (!evidence) {
      provisionalFinding = null;
      return { confirmations: 0, context: 0 };
    }
    const { operation } = evidence;
    const context = countFindingContextPhonemes(candidate.alignment.operations, operation);
    const fingerprint = findingFingerprint(corpus, candidate, operation, actualPhonemes);
    if (!fingerprint) {
      provisionalFinding = null;
      return { confirmations: 0, context };
    }
    provisionalFinding = advanceProvisionalFinding(
      provisionalFinding,
      fingerprint,
      evidence,
      context,
    );
    return { confirmations: provisionalFinding?.confirmations ?? 0, context };
  };

  const commitSupportedWords = (
    candidate: AlignmentCandidate,
    observation: RecitationObservation,
  ): void => {
    const consumed = new Set<number>();
    const matched = new Set<number>();
    for (const operation of candidate.alignment.operations) {
      if (operation.referenceIndex === null || operation.actualIndex === null) continue;
      const absoluteIndex = candidate.symbolIndex + operation.referenceIndex;
      consumed.add(absoluteIndex);
      if (operation.kind === 'match') matched.add(absoluteIndex);
    }

    for (const wordId of collectTouchedWordIds(candidate, symbolWordIds)) {
      const touchedWord = orderedWordsById.get(wordId);
      if (!touchedWord) continue;
      const { word, range } = touchedWord;
      if (range.end - 1 < committedSymbol || range.start < candidate.symbolIndex) continue;
      let wordConsumed = true;
      for (let symbolIndex = range.start; symbolIndex < range.end; symbolIndex += 1) {
        if (!consumed.has(symbolIndex)) {
          wordConsumed = false;
          break;
        }
      }
      if (!wordConsumed) continue;

      let hasLookahead = observation.isFinal;
      if (!hasLookahead) {
        hasLookahead = true;
        for (let offset = 0; offset < PARTIAL_COMMIT_LOOKAHEAD; offset += 1) {
          if (!matched.has(range.end + offset)) {
            hasLookahead = false;
            break;
          }
        }
      }
      if (!hasLookahead) continue;

      if (!completedWordIdSet.has(word.id)) {
        completedWordIdSet.add(word.id);
        completedWordIds.push(word.id);
      }
      committedSymbol = Math.max(committedSymbol, range.end - 1);
    }
  };

  const reset = (location: QuranLocation = defaultInitialLocation): ReadingSnapshot => {
    initialSymbol = symbolIndexAt(corpus, location);
    cursorSymbol = initialSymbol;
    committedSymbol = initialSymbol;
    latestSourceRevision = -1;
    observationIds = new Set();
    observationIdOrder = [];
    hypothesisHistory = [];
    provisionalFinding = null;
    completedWordIds = [];
    completedWordIdSet = new Set();
    snapshot = freezeSnapshot({
      revision: snapshot.revision + 1,
      observationId: null,
      display: { location, isReread: false, activeWordId: null },
      commit: { location, completedWordIds },
      confidence: null,
      finding: null,
    });
    return snapshot;
  };

  return Object.freeze({
    getSnapshot(): ReadingSnapshot {
      return snapshot;
    },

    submit(observation: RecitationObservation): ReadingSnapshot {
      validateObservation(observation);
      if (observationIds.has(observation.observationId)
        || observation.sourceRevision < latestSourceRevision) return snapshot;

      rememberObservationId(observation.observationId);
      latestSourceRevision = observation.sourceRevision;
      const actualPhonemes = observationPhonemes(observation);
      const located = locateObservation(corpus, observation, options.metricsSink
        ? { cursorSymbol, committedSymbol, metricsSink: options.metricsSink }
        : { cursorSymbol, committedSymbol });
      const candidate = located.best;
      let confidence: ConfidenceEvidence | null = null;
      let finding: ConfirmedFinding | null = null;
      let display = snapshot.display;

      if (candidate) {
        const fingerprint = hypothesisFingerprint(candidate);
        confidence = scoreConfidence({
          alignment: candidate.score,
          stability: stabilityFor(fingerprint, hypothesisHistory),
          matchedLookaheadCount: candidate.alignment.matchedLookaheadCount,
          margin: locationScoreMargin(candidate, located.second),
          actualPhonemeCount: actualPhonemes.length,
          acousticConfidences: acousticConfidences(observation),
        });
        rememberHypothesis(fingerprint);

        if (passesPositionGate(confidence)) {
          const activeSymbol = Math.min(
            corpus.symbols.length - 1,
            candidate.symbolIndex + activeReferenceOffset(candidate),
          );
          cursorSymbol = activeSymbol;
          display = Object.freeze({
            location: corpus.symbols[activeSymbol]!.location,
            isReread: activeSymbol < committedSymbol,
            activeWordId: symbolWordIds[activeSymbol] ?? null,
          });
          commitSupportedWords(candidate, observation);
        }

        if (findingMode === 'substitutions' && !candidate.isReread) {
          const substitutionEvidence = deriveSubstitutionEvidence(candidate, confidence);
          const provisional = updateProvisionalFinding(
            candidate,
            actualPhonemes,
            substitutionEvidence,
          );
          finding = classifyFindingWithEvidence({
            corpus,
            candidate,
            observation,
            actualPhonemes,
            confidence,
            confirmations: provisional.confirmations,
            contextPhonemeCount: provisional.context,
          }, substitutionEvidence);
        } else {
          provisionalFinding = null;
        }
      } else {
        provisionalFinding = null;
      }

      snapshot = freezeSnapshot({
        revision: snapshot.revision + 1,
        observationId: observation.observationId,
        display,
        commit: {
          location: corpus.symbols[committedSymbol]!.location,
          completedWordIds,
        },
        confidence,
        finding,
      });
      return snapshot;
    },

    reset,
  });
}
