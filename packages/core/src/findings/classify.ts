/**
 * Substitution finding construction from one edit-path operation.
 *
 * @license Apache-2.0
 */

import type { AlignmentCandidate } from '../alignment/types.ts';
import {
  passesFinalFindingGate,
  passesImmediateFindingGate,
  passesPositionGate,
  passesSoftFindingGate,
} from '../confidence/score.ts';
import type { ConfidenceEvidence } from '../confidence/types.ts';
import type { IndexedCorpus } from '../corpus/types.ts';
import type { RecitationObservation } from '../observation/types.ts';
import type {
  ConfirmedFinding,
  FindingConfirmation,
  SubstitutionEvidence,
  SubstitutionOperation,
} from './types.ts';

export type FindingClassificationInput = Readonly<{
  corpus: IndexedCorpus;
  candidate: AlignmentCandidate;
  observation: RecitationObservation;
  actualPhonemes: readonly string[];
  confidence: ConfidenceEvidence;
  confirmations: number;
  contextPhonemeCount: number;
}>;

function substitutionOperation(candidate: AlignmentCandidate): SubstitutionOperation | null {
  for (const operation of candidate.alignment.operations) {
    if (operation.kind === 'substitution') return operation;
  }
  return null;
}

function substitutionLookaheadCount(
  candidate: AlignmentCandidate,
  operation: SubstitutionOperation,
): number {
  const operationIndex = candidate.alignment.operations.indexOf(operation);
  let matches = 0;
  for (let index = operationIndex + 1; index < candidate.alignment.operations.length; index += 1) {
    if (candidate.alignment.operations[index]!.kind !== 'match') break;
    matches += 1;
  }
  return matches;
}

/** Derives the selected substitution and its own lookahead-adjusted confidence once. */
export function deriveSubstitutionEvidence(
  candidate: AlignmentCandidate,
  confidence: ConfidenceEvidence,
): SubstitutionEvidence | null {
  if (candidate.isReread) return null;
  const operation = substitutionOperation(candidate);
  if (!operation) return null;
  const matchedLookaheadCount = substitutionLookaheadCount(candidate, operation);
  const lookahead = Math.min(1, matchedLookaheadCount / 2);
  const lookaheadWeight = confidence.acoustic === null ? 0.2 : 0.17;
  return Object.freeze({
    operation: Object.freeze({ ...operation }),
    confidence: Object.freeze({
      ...confidence,
      lookahead,
      matchedLookaheadCount,
      combined: confidence.combined
        + (lookahead - confidence.lookahead) * lookaheadWeight,
    }),
  });
}

function confirmationMode(
  input: FindingClassificationInput,
  confidence: ConfidenceEvidence,
): FindingConfirmation | null {
  if (!passesPositionGate(confidence)) return null;
  if (passesImmediateFindingGate(confidence)) return 'immediate';
  if (input.observation.isFinal && passesFinalFindingGate(confidence)) return 'final';
  if (passesSoftFindingGate(
    confidence,
    input.confirmations,
    input.contextPhonemeCount,
  )) return 'soft';
  return null;
}

/** @internal Builds a finding from evidence derived inside the core package. */
export function classifyFindingWithEvidence(
  input: FindingClassificationInput,
  evidence: SubstitutionEvidence | null,
): ConfirmedFinding | null {
  if (input.candidate.isReread) return null;
  const selected = substitutionOperation(input.candidate);
  if (!selected || !evidence
    || evidence.operation.actualIndex !== selected.actualIndex
    || evidence.operation.referenceIndex !== selected.referenceIndex) return null;
  const { operation, confidence } = evidence;
  const confirmation = confirmationMode(input, confidence);
  if (!confirmation) return null;

  const actualPhoneme = input.actualPhonemes[operation.actualIndex];
  const referenceSymbol = input.corpus.symbols[
    input.candidate.symbolIndex + operation.referenceIndex
  ];
  if (actualPhoneme === undefined || !referenceSymbol) return null;

  return Object.freeze({
    type: 'substitution',
    confirmation,
    observationId: input.observation.observationId,
    operation: Object.freeze({ ...operation }),
    actualPhoneme,
    referencePhoneme: referenceSymbol.phoneme,
    referenceSymbolId: referenceSymbol.id,
    location: Object.freeze({ ...referenceSymbol.location }),
    confidence: Object.freeze({ ...confidence }),
    confirmations: confirmation === 'soft' ? input.confirmations : 1,
  });
}

/** Builds a finding only from evidence recomputed from the supplied candidate. */
export function classifyFinding(input: FindingClassificationInput): ConfirmedFinding | null {
  return classifyFindingWithEvidence(
    input,
    deriveSubstitutionEvidence(input.candidate, input.confidence),
  );
}
