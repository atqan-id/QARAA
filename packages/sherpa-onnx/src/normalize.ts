/**
 * Pure structural conversion from recognizer-shaped output to core observations.
 *
 * @license Apache-2.0
 */

import { validateObservation } from '@atqan/qaraa-core';
import type { ObservationToken, RecitationObservation } from '@atqan/qaraa-core';

import {
  SherpaNormalizationError,
  type NormalizeSherpaResultOptions,
  type SherpaResultLike,
} from './types.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function validProbabilityArray(value: unknown, tokenCount: number): value is readonly number[] {
  return Array.isArray(value)
    && value.length === tokenCount
    && value.every((probability) => typeof probability === 'number'
      && Number.isFinite(probability)
      && probability >= 0
      && probability <= 1);
}

/**
 * Returns timestamp starts in milliseconds only when the whole source array is
 * an ordered, non-negative, finite seconds array aligned to the input tokens.
 */
function validTimestampArray(value: unknown, tokenCount: number): readonly number[] | undefined {
  if (!Array.isArray(value) || value.length !== tokenCount) return undefined;

  const milliseconds: number[] = [];
  let previousSeconds: number | undefined;
  for (const timestamp of value) {
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0
      || (previousSeconds !== undefined && timestamp < previousSeconds)) return undefined;
    const timestampMs = Math.round(timestamp * 1_000);
    if (!Number.isFinite(timestampMs)) return undefined;
    milliseconds.push(timestampMs);
    previousSeconds = timestamp;
  }
  return milliseconds;
}

function requireOptions(options: unknown): asserts options is NormalizeSherpaResultOptions {
  if (!isRecord(options)) {
    throw new SherpaNormalizationError('INVALID_OPTIONS', 'options must be an object');
  }
  if (typeof options.observationId !== 'string' || options.observationId.trim() === '') {
    throw new SherpaNormalizationError('INVALID_OPTIONS', 'observationId must be a non-empty string');
  }
  if (typeof options.sourceRevision !== 'number'
    || !Number.isSafeInteger(options.sourceRevision)
    || options.sourceRevision < 0) {
    throw new SherpaNormalizationError('INVALID_OPTIONS', 'sourceRevision must be a non-negative safe integer');
  }
  if (typeof options.isFinal !== 'boolean') {
    throw new SherpaNormalizationError('INVALID_OPTIONS', 'isFinal must be a boolean');
  }
  if (typeof options.receivedAtMs !== 'number' || !Number.isFinite(options.receivedAtMs) || options.receivedAtMs < 0) {
    throw new SherpaNormalizationError('INVALID_OPTIONS', 'receivedAtMs must be a non-negative finite number');
  }
  if (typeof options.tokenMapper !== 'function') {
    throw new SherpaNormalizationError('INVALID_OPTIONS', 'tokenMapper must be a function');
  }
}

function requireTokens(result: unknown): readonly string[] {
  if (!isRecord(result) || !Array.isArray(result.tokens) || result.tokens.some((token) => typeof token !== 'string')) {
    throw new SherpaNormalizationError('INVALID_RESULT', 'result.tokens must be an array of strings');
  }
  return result.tokens;
}

function mapToken(
  token: string,
  index: number,
  options: NormalizeSherpaResultOptions,
): Readonly<{ text: string; phonemes: readonly string[] }> | null {
  const mapped = options.tokenMapper(token, index);
  if (mapped === null) return null;
  if (mapped === undefined) {
    throw new SherpaNormalizationError('UNKNOWN_TOKEN', `token at index ${index} is not mapped`, { token, index });
  }
  if (typeof mapped.text !== 'string' || !Array.isArray(mapped.phonemes)
    || mapped.phonemes.some((phoneme) => typeof phoneme !== 'string')) {
    throw new SherpaNormalizationError('INVALID_TOKEN_MAPPING', `token at index ${index} has an invalid mapping`, { token, index });
  }
  return mapped;
}

function probabilities(result: Readonly<Record<string, unknown>>, tokenCount: number): readonly number[] | undefined {
  if ('ys_probs' in result) {
    return validProbabilityArray(result.ys_probs, tokenCount) ? result.ys_probs : undefined;
  }
  return validProbabilityArray(result.ysProbs, tokenCount) ? result.ysProbs : undefined;
}

/**
 * Normalizes structural recognizer output without importing a recognizer or
 * binding this package to a token table, model, or credential.
 */
export function normalizeSherpaResult(
  result: SherpaResultLike,
  options: NormalizeSherpaResultOptions,
): RecitationObservation {
  requireOptions(options);
  const tokens = requireTokens(result);
  const source = result as Readonly<Record<string, unknown>>;
  const timestampStarts = validTimestampArray(source.timestamps, tokens.length);
  const confidence = probabilities(source, tokens.length);
  const normalized: ObservationToken[] = [];

  for (const [index, token] of tokens.entries()) {
    const mapped = mapToken(token, index, options);
    if (mapped === null) continue;

    const observationToken: {
      id: string;
      text: string;
      phonemes: readonly string[];
      startMs?: number;
      endMs?: number;
      confidence?: number;
    } = {
      id: `sherpa-${index}`,
      text: mapped.text,
      phonemes: Object.freeze([...mapped.phonemes]),
    };
    if (timestampStarts !== undefined) {
      observationToken.startMs = timestampStarts[index]!;
      const endMs = timestampStarts[index + 1];
      if (endMs !== undefined) observationToken.endMs = endMs;
    }
    if (confidence !== undefined) observationToken.confidence = confidence[index]!;
    normalized.push(Object.freeze(observationToken));
  }

  const observation: RecitationObservation = {
    observationId: options.observationId,
    sourceRevision: options.sourceRevision,
    isFinal: options.isFinal,
    receivedAtMs: options.receivedAtMs,
    tokens: Object.freeze(normalized),
  };
  try {
    validateObservation(observation);
  } catch {
    throw new SherpaNormalizationError('INVALID_RESULT', 'result cannot form a valid core observation');
  }
  return Object.freeze(observation);
}
