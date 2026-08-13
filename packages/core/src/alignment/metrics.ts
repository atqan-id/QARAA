/**
 * Optional operation-level instrumentation for tests and benchmark harnesses.
 *
 * @license Apache-2.0
 */

export interface AlignmentMetricsSink {
  recordCandidateEvaluation(symbolIndex: number): void;
  recordEditCell(actualIndex: number, referenceIndex: number): void;
  recordCorpusSymbolAccess(symbolIndex: number): void;
}
