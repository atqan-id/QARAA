/**
 * Structural input and output contracts for the optional normalizer.
 *
 * @license Apache-2.0
 */

import type { RecitationObservation } from '@atqan/qaraa-core';

/** A structural subset of recognizer output; no recognizer package is required. */
export type SherpaResultLike = Readonly<{
  tokens: readonly string[];
  timestamps?: unknown;
  ys_probs?: unknown;
  ysProbs?: unknown;
}>;

/** Maps a recognizer token into the core text and phoneme representation. */
export type TokenMapper = (
  token: string,
  index: number,
) => Readonly<{ text: string; phonemes: readonly string[] }> | null;

/** Required core metadata and token mapping supplied by the adapter consumer. */
export type NormalizeSherpaResultOptions = Readonly<{
  observationId: string;
  sourceRevision: number;
  isFinal: boolean;
  receivedAtMs: number;
  tokenMapper: TokenMapper;
}>;

export type SherpaNormalizationErrorCode =
  | 'INVALID_OPTIONS'
  | 'INVALID_RESULT'
  | 'INVALID_TOKEN_MAPPING'
  | 'UNKNOWN_TOKEN';

/** A typed normalization failure that can be handled without recognizer imports. */
export class SherpaNormalizationError extends Error {
  readonly code: SherpaNormalizationErrorCode;
  readonly token?: string;
  readonly index?: number;

  constructor(
    code: SherpaNormalizationErrorCode,
    message: string,
    context: Readonly<{ token?: string; index?: number }> = {},
  ) {
    super(message);
    this.name = 'SherpaNormalizationError';
    this.code = code;
    if (context.token !== undefined) this.token = context.token;
    if (context.index !== undefined) this.index = context.index;
  }
}

export type NormalizedSherpaObservation = RecitationObservation;
