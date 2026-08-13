/**
 * Core contracts for QARAA recitation alignment.
 *
 * @license Apache-2.0
 */

export { indexCorpus } from './corpus/index-corpus.ts';
export {
  OBSERVATION_LIMITS,
  validateCorpus,
  validateObservation,
} from './corpus/validate.ts';
export { alignPhonemes } from './alignment/edit-path.ts';
export { locateObservation } from './alignment/locate.ts';
export {
  passesFinalFindingGate,
  passesImmediateFindingGate,
  passesPositionGate,
  passesSoftFindingGate,
  scoreConfidence,
} from './confidence/score.ts';
export { classifyFinding } from './findings/classify.ts';
export { createReadingTracker } from './tracking/reading-tracker.ts';
export type {
  AlignmentCandidate,
  AlignmentOperation,
  AlignmentPath,
} from './alignment/types.ts';
export type { AlignmentMetricsSink } from './alignment/metrics.ts';
export type {
  CorpusRange,
  IndexedCorpus,
  QuranCorpus,
  QuranLocation,
  QuranSymbol,
  QuranWord,
} from './corpus/types.ts';
export type { ConfidenceEvidence, ConfidenceInput } from './confidence/types.ts';
export type { FindingClassificationInput } from './findings/classify.ts';
export type {
  ConfirmedFinding,
  FindingConfirmation,
  SubstitutionOperation,
} from './findings/types.ts';
export type { ObservationToken, RecitationObservation } from './observation/types.ts';
export type {
  FindingMode,
  ReadingSnapshot,
  ReadingTracker,
  ReadingTrackerOptions,
} from './tracking/types.ts';
