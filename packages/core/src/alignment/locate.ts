/**
 * Context-aware global location for normalized recitation observations.
 *
 * @license Apache-2.0
 */

import type { IndexedCorpus } from '../corpus/types.ts';
import { validateObservation } from '../corpus/validate.ts';
import type { RecitationObservation } from '../observation/types.ts';
import { retrieveCandidatePositions } from './candidates.ts';
import {
  alignPhonemesWithWorkspace,
  createAlignmentWorkspace,
  type AlignmentWorkspace,
} from './edit-path.ts';
import type { AlignmentCandidate, AlignmentPath } from './types.ts';
import type { AlignmentMetricsSink } from './metrics.ts';

const GLOBAL_FALLBACK_THRESHOLD = 0.72;
const MAX_REFERENCE_LENGTH_VARIATION = 3;

function observationPhonemes(observation: RecitationObservation): string[] {
  const phonemes: string[] = [];
  for (const token of observation.tokens) phonemes.push(...token.phonemes);
  return phonemes;
}

function leadingContinuity(alignment: AlignmentPath, actualLength: number): number {
  let matches = 0;
  for (const operation of alignment.operations) {
    if (operation.kind !== 'match') break;
    matches += 1;
  }
  return actualLength === 0 ? 0 : matches / actualLength;
}

function evaluateCandidate(
  index: IndexedCorpus,
  actual: readonly string[],
  symbolIndex: number,
  cursorSymbol: number,
  committedSymbol: number,
  reference: string[],
  workspace: AlignmentWorkspace,
  metricsSink?: AlignmentMetricsSink,
): AlignmentCandidate {
  metricsSink?.recordCandidateEvaluation(symbolIndex);
  const availableLength = index.symbols.length - symbolIndex;
  const minimumLength = Math.min(
    availableLength,
    Math.max(1, actual.length - MAX_REFERENCE_LENGTH_VARIATION),
  );
  const maximumLength = Math.min(
    availableLength,
    actual.length + MAX_REFERENCE_LENGTH_VARIATION,
  );
  let alignment: AlignmentPath | undefined;
  let secondSpanScore = 0;
  let spanCount = 0;
  for (let referenceLength = minimumLength; referenceLength <= maximumLength; referenceLength += 1) {
    spanCount += 1;
    reference.length = referenceLength;
    for (let offset = 0; offset < referenceLength; offset += 1) {
      metricsSink?.recordCorpusSymbolAccess(symbolIndex + offset);
      reference[offset] = index.symbols[symbolIndex + offset]!.phoneme;
    }
    const current = alignPhonemesWithWorkspace(actual, reference, workspace, metricsSink);
    const currentWins = alignment === undefined
      || current.score > alignment.score
      || (current.score === alignment.score && current.editCount < alignment.editCount)
      || (current.score === alignment.score
        && current.editCount === alignment.editCount
        && current.matchedLookaheadCount > alignment.matchedLookaheadCount);
    if (currentWins) {
      secondSpanScore = alignment?.score ?? 0;
      alignment = current;
    } else {
      secondSpanScore = Math.max(secondSpanScore, current.score);
    }
  }
  reference.length = 0;
  alignment ??= alignPhonemesWithWorkspace(actual, reference, workspace, metricsSink);
  return Object.freeze({
    symbolIndex,
    location: index.symbols[symbolIndex]!.location,
    alignment,
    score: alignment.score,
    scoreMargin: spanCount < 2 ? 0 : Math.max(0, alignment.score - secondSpanScore),
    cursorDistance: Math.abs(symbolIndex - cursorSymbol),
    continuity: leadingContinuity(alignment, actual.length),
    forwardMovement: Math.max(0, symbolIndex - cursorSymbol),
    isReread: symbolIndex < committedSymbol,
  });
}

function compareCandidates(left: AlignmentCandidate, right: AlignmentCandidate): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.scoreMargin !== right.scoreMargin) return right.scoreMargin - left.scoreMargin;
  if (left.cursorDistance !== right.cursorDistance) return left.cursorDistance - right.cursorDistance;
  if (left.continuity !== right.continuity) return right.continuity - left.continuity;
  if (left.forwardMovement !== right.forwardMovement) return left.forwardMovement - right.forwardMovement;
  return left.symbolIndex - right.symbolIndex;
}

/** Locates an observation while keeping local and global work strictly bounded. */
export function locateObservation(
  index: IndexedCorpus,
  observation: RecitationObservation,
  context: Readonly<{
    cursorSymbol: number;
    committedSymbol: number;
    metricsSink?: AlignmentMetricsSink;
  }>,
): Readonly<{ best: AlignmentCandidate | null; second: AlignmentCandidate | null }> {
  validateObservation(observation);
  const actual = observationPhonemes(observation);
  if (actual.length === 0 || index.symbols.length === 0) {
    return Object.freeze({ best: null, second: null });
  }

  const cursorSymbol = Math.max(0, Math.min(context.cursorSymbol, index.symbols.length - 1));
  const maximumReferenceLength = Math.min(
    index.symbols.length,
    actual.length + MAX_REFERENCE_LENGTH_VARIATION,
  );
  const reference = new Array<string>(maximumReferenceLength);
  const workspace = createAlignmentWorkspace(actual.length, maximumReferenceLength);
  const evaluated = new Map<number, AlignmentCandidate>();
  const evaluatePositions = (positions: readonly number[]): void => {
    for (const position of positions) {
      if (!evaluated.has(position)) {
        evaluated.set(position, evaluateCandidate(
          index,
          actual,
          position,
          cursorSymbol,
          context.committedSymbol,
          reference,
          workspace,
          context.metricsSink,
        ));
      }
    }
  };

  evaluatePositions(retrieveCandidatePositions(
    index,
    actual,
    cursorSymbol,
    false,
    context.metricsSink,
  ));
  let localBestScore = 0;
  for (const candidate of evaluated.values()) {
    localBestScore = Math.max(localBestScore, candidate.score);
  }
  if (localBestScore < GLOBAL_FALLBACK_THRESHOLD) {
    evaluatePositions(retrieveCandidatePositions(
      index,
      actual,
      cursorSymbol,
      true,
      context.metricsSink,
    ));
  }

  const ranked = [...evaluated.values()].sort(compareCandidates);
  return Object.freeze({
    best: ranked[0] ?? null,
    second: ranked[1] ?? null,
  });
}
