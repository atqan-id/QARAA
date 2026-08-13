/**
 * Confidence-gated recitation finding contracts.
 *
 * @license Apache-2.0
 */

import type { AlignmentOperation } from '../alignment/types.ts';
import type { ConfidenceEvidence } from '../confidence/types.ts';
import type { QuranLocation } from '../corpus/types.ts';

export type SubstitutionOperation = Extract<AlignmentOperation, { kind: 'substitution' }>;
export type FindingConfirmation = 'immediate' | 'final' | 'soft';

export type SubstitutionEvidence = Readonly<{
  operation: SubstitutionOperation;
  confidence: ConfidenceEvidence;
}>;

/**
 * A substitution pair bound to the single edit-path operation that produced it.
 * Actual and reference indexes cannot be supplied independently.
 */
export type ConfirmedFinding = Readonly<{
  type: 'substitution';
  confirmation: FindingConfirmation;
  observationId: string;
  operation: SubstitutionOperation;
  actualPhoneme: string;
  referencePhoneme: string;
  referenceSymbolId: string;
  location: QuranLocation;
  confidence: ConfidenceEvidence;
  confirmations: number;
}>;
