/**
 * Producer-neutral recitation observation contracts.
 *
 * @license Apache-2.0
 */

export type ObservationToken = Readonly<{
  id: string;
  text: string;
  phonemes: readonly string[];
  startMs?: number;
  endMs?: number;
  confidence?: number;
}>;

export type RecitationObservation = Readonly<{
  observationId: string;
  sourceRevision: number;
  isFinal: boolean;
  receivedAtMs: number;
  tokens: readonly ObservationToken[];
}>;
