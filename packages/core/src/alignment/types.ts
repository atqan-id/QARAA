/**
 * Phoneme alignment and corpus-location result contracts.
 *
 * @license Apache-2.0
 */

import type { QuranLocation } from '../corpus/types.ts';

export type AlignmentOperation =
  | Readonly<{ kind: 'match'; actualIndex: number; referenceIndex: number; score: number }>
  | Readonly<{ kind: 'substitution'; actualIndex: number; referenceIndex: number; score: number }>
  | Readonly<{ kind: 'insertion'; actualIndex: number; referenceIndex: null; score: number }>
  | Readonly<{ kind: 'deletion'; actualIndex: null; referenceIndex: number; score: number }>;

export type AlignmentPath = Readonly<{
  score: number;
  editCount: number;
  matchedLookaheadCount: number;
  operations: readonly AlignmentOperation[];
}>;

export type AlignmentCandidate = Readonly<{
  symbolIndex: number;
  location: QuranLocation;
  alignment: AlignmentPath;
  score: number;
  scoreMargin: number;
  cursorDistance: number;
  continuity: number;
  forwardMovement: number;
  isReread: boolean;
}>;
