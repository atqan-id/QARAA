/**
 * Confidence evidence and scoring inputs for stable reading decisions.
 *
 * @license Apache-2.0
 */

export type ConfidenceInput = Readonly<{
  alignment: number;
  stability: number;
  matchedLookaheadCount: number;
  margin: number;
  actualPhonemeCount: number;
  acousticConfidences?: readonly (number | null | undefined)[];
}>;

export type ConfidenceEvidence = Readonly<{
  alignment: number;
  stability: number;
  lookahead: number;
  matchedLookaheadCount: number;
  margin: number;
  acoustic: number | null;
  combined: number;
}>;
