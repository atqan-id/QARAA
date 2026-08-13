/**
 * Deterministic confidence scoring and approved decision gates.
 *
 * @license Apache-2.0
 */

import type { ConfidenceEvidence, ConfidenceInput } from './types.ts';

const POSITION_ALIGNMENT_THRESHOLD = 0.72;
const POSITION_MARGIN_THRESHOLD = 0.08;
const IMMEDIATE_CONFIDENCE_THRESHOLD = 0.9;
const IMMEDIATE_MARGIN_THRESHOLD = 0.15;
const FINAL_CONFIDENCE_THRESHOLD = 0.82;
const FINAL_MARGIN_THRESHOLD = 0.1;
const SOFT_CONFIDENCE_THRESHOLD = 0.88;

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function alignedAcousticConfidence(input: ConfidenceInput): number | null {
  const values = input.acousticConfidences;
  if (!values
    || !Number.isSafeInteger(input.actualPhonemeCount)
    || input.actualPhonemeCount <= 0
    || values.length !== input.actualPhonemeCount) {
    return null;
  }

  let total = 0;
  let count = 0;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
      total += value;
      count += 1;
    }
  }
  return count === 0 ? null : total / count;
}

/** Scores one locator hypothesis using only aligned, bounded evidence. */
export function scoreConfidence(input: ConfidenceInput): ConfidenceEvidence {
  const alignment = clampUnit(input.alignment);
  const stability = clampUnit(input.stability);
  const matchedLookaheadCount = Number.isSafeInteger(input.matchedLookaheadCount)
    ? Math.max(0, input.matchedLookaheadCount)
    : 0;
  const lookahead = Math.min(1, matchedLookaheadCount / 2);
  const margin = clampUnit(input.margin);
  const acoustic = alignedAcousticConfidence(input);
  const combined = acoustic === null
    ? alignment * 0.4 + stability * 0.25 + lookahead * 0.2 + margin * 0.15
    : alignment * 0.34
      + stability * 0.2125
      + lookahead * 0.17
      + margin * 0.1275
      + acoustic * 0.15;

  return Object.freeze({
    alignment,
    stability,
    lookahead,
    matchedLookaheadCount,
    margin,
    acoustic,
    combined,
  });
}

/** True when a position is strong enough to change the display cursor. */
export function passesPositionGate(evidence: ConfidenceEvidence): boolean {
  return evidence.alignment >= POSITION_ALIGNMENT_THRESHOLD
    && evidence.margin >= POSITION_MARGIN_THRESHOLD;
}

/** True when a substitution has enough lookahead to be confirmed immediately. */
export function passesImmediateFindingGate(evidence: ConfidenceEvidence): boolean {
  return evidence.combined >= IMMEDIATE_CONFIDENCE_THRESHOLD
    && evidence.margin >= IMMEDIATE_MARGIN_THRESHOLD
    && evidence.matchedLookaheadCount >= 2;
}

/** True when a final hypothesis supplies sufficient otherwise-ambiguous evidence. */
export function passesFinalFindingGate(evidence: ConfidenceEvidence): boolean {
  return evidence.combined >= FINAL_CONFIDENCE_THRESHOLD
    && evidence.margin >= FINAL_MARGIN_THRESHOLD;
}

/** True when repeated soft evidence has the approved local phoneme context. */
export function passesSoftFindingGate(
  evidence: ConfidenceEvidence,
  confirmations: number,
  contextPhonemeCount: number,
): boolean {
  return evidence.combined >= SOFT_CONFIDENCE_THRESHOLD
    && confirmations >= 2
    && contextPhonemeCount >= 2
    && contextPhonemeCount <= 3;
}
