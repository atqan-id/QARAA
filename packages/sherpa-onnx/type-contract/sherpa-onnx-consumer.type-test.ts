/**
 * Strict non-DOM downstream contract for the optional structural normalizer.
 *
 * @license Apache-2.0
 */

import type { RecitationObservation } from '@atqan/qaraa-core';
import {
  normalizeSherpaResult,
  type SherpaResultLike,
  type TokenMapper,
} from '@atqan/qaraa-sherpa-onnx';

declare const recognizerResult: SherpaResultLike;

const tokenMapper: TokenMapper = (token) => token === '<blank>'
  ? null
  : { text: token, phonemes: [token] };

const observation: RecitationObservation = normalizeSherpaResult(recognizerResult, {
  observationId: 'consumer-observation',
  sourceRevision: 0,
  isFinal: false,
  receivedAtMs: 0,
  tokenMapper,
});

void observation;
