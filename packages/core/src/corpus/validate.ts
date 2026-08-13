/**
 * Deterministic validation for corpus and observation boundary values.
 *
 * @license Apache-2.0
 */

import type { QuranCorpus, QuranLocation, QuranSymbol, QuranWord } from './types.ts';
import type { ObservationToken, RecitationObservation } from '../observation/types.ts';

/** Semantic work and memory ceilings applied before alignment begins. */
export const OBSERVATION_LIMITS = Object.freeze({
  maxTokens: 64,
  maxPhonemes: 128,
  maxObservationIdLength: 256,
  maxTokenIdLength: 256,
  maxTokenTextLength: 1_024,
  maxPhonemeLength: 128,
});

function fail(message: string): never {
  throw new TypeError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`);
}

function requireStringLength(value: string, maximum: number, label: string): void {
  if (value.length > maximum) fail(`${label} must contain at most ${maximum} UTF-16 code units`);
}

function requirePositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive integer`);
  }
}

function requireFiniteTimestamp(value: unknown, label: string): asserts value is number {
  if (!Number.isFinite(value) || (value as number) < 0) fail(`${label} must be a non-negative finite timestamp`);
}

function compareLocation(left: QuranLocation, right: QuranLocation): number {
  const fields: (keyof QuranLocation)[] = ['surah', 'ayah', 'word', 'symbol'];
  for (const field of fields) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }
  return 0;
}

function compareWordLocation(left: QuranWord['location'], right: QuranWord['location']): number {
  if (left.surah !== right.surah) return left.surah - right.surah;
  if (left.ayah !== right.ayah) return left.ayah - right.ayah;
  return left.word - right.word;
}

function validateLocation(location: unknown, label: string, includesSymbol: boolean): void {
  if (!isRecord(location)) fail(`${label} must be an address`);
  requirePositiveInteger(location.surah, `${label}.surah`);
  requirePositiveInteger(location.ayah, `${label}.ayah`);
  requirePositiveInteger(location.word, `${label}.word`);
  if (includesSymbol) requirePositiveInteger(location.symbol, `${label}.symbol`);
}

function validateSymbol(symbol: unknown): asserts symbol is QuranSymbol {
  if (!isRecord(symbol)) fail('symbol must be an object');
  requireNonEmptyString(symbol.id, 'symbol id');
  if (typeof symbol.text !== 'string') fail('symbol text must be a string');
  requireNonEmptyString(symbol.phoneme, 'symbol phoneme');
  validateLocation(symbol.location, 'symbol location', true);
}

function validateWord(word: unknown): asserts word is QuranWord {
  if (!isRecord(word)) fail('word must be an object');
  requireNonEmptyString(word.id, 'word id');
  if (typeof word.text !== 'string') fail('word text must be a string');
  if (!Array.isArray(word.symbolIds) || word.symbolIds.length === 0) fail('word must reference at least one symbol');
  for (const symbolId of word.symbolIds) requireNonEmptyString(symbolId, 'word symbol id');
  validateLocation(word.location, 'word location', false);
}

/** Validates a complete canonical corpus without modifying it. */
export function validateCorpus(corpus: QuranCorpus): void {
  if (!isRecord(corpus)) fail('corpus must be an object');
  requireNonEmptyString(corpus.corpusId, 'corpus id');
  requireNonEmptyString(corpus.revision, 'corpus revision');
  if (!Array.isArray(corpus.symbols) || !Array.isArray(corpus.words)) fail('corpus symbols and words must be arrays');

  const symbolsById = new Map<string, QuranSymbol>();
  const symbolIndexes = new Map<string, number>();
  let previousSymbol: QuranSymbol | undefined;
  for (const [symbolIndex, symbol] of corpus.symbols.entries()) {
    validateSymbol(symbol);
    if (symbolsById.has(symbol.id)) fail('duplicate symbol id');
    if (previousSymbol && compareLocation(previousSymbol.location, symbol.location) >= 0) {
      fail('symbol locations must be strictly monotonic');
    }
    symbolsById.set(symbol.id, symbol);
    symbolIndexes.set(symbol.id, symbolIndex);
    previousSymbol = symbol;
  }

  const wordsById = new Set<string>();
  const referencedSymbols = new Set<string>();
  let previousWord: QuranWord | undefined;
  for (const word of corpus.words) {
    validateWord(word);
    if (wordsById.has(word.id)) fail('duplicate word id');
    if (previousWord && compareWordLocation(previousWord.location, word.location) >= 0) {
      fail('word locations must be strictly monotonic');
    }

    let previousSymbolIndex = -1;
    for (const symbolId of word.symbolIds) {
      const symbol = symbolsById.get(symbolId);
      if (!symbol) fail(`word references missing symbol: ${symbolId}`);
      if (symbol.location.surah !== word.location.surah || symbol.location.ayah !== word.location.ayah) {
        fail('word symbols must not span multiple ayat');
      }
      if (symbol.location.word !== word.location.word) fail('word symbols must match the word location');
      const symbolIndex = symbolIndexes.get(symbolId)!;
      if (symbolIndex <= previousSymbolIndex) fail('word symbol IDs must be strictly ordered');
      if (referencedSymbols.has(symbolId)) fail('symbol is referenced by multiple words');
      referencedSymbols.add(symbolId);
      previousSymbolIndex = symbolIndex;
    }
    wordsById.add(word.id);
    previousWord = word;
  }

  for (const symbol of corpus.symbols) {
    if (!referencedSymbols.has(symbol.id)) fail('symbol is missing from its word');
  }
}

function validateObservationToken(token: unknown, lastTimestamp: number | undefined): number | undefined {
  if (!isRecord(token)) fail('observation token must be an object');
  requireNonEmptyString(token.id, 'observation token id');
  requireStringLength(token.id, OBSERVATION_LIMITS.maxTokenIdLength, 'observation token id');
  if (typeof token.text !== 'string') fail('observation token text must be a string');
  requireStringLength(token.text, OBSERVATION_LIMITS.maxTokenTextLength, 'observation token text');
  if (!Array.isArray(token.phonemes) || token.phonemes.some((phoneme) => typeof phoneme !== 'string')) {
    fail('observation token phonemes must be strings');
  }
  for (const phoneme of token.phonemes) {
    requireStringLength(phoneme, OBSERVATION_LIMITS.maxPhonemeLength, 'observation token phoneme');
  }

  let latest = lastTimestamp;
  for (const [name, value] of [['startMs', token.startMs], ['endMs', token.endMs]] as const) {
    if (value === undefined) continue;
    requireFiniteTimestamp(value, `observation token ${name}`);
    if (latest !== undefined && value < latest) fail('observation token timestamps must not decrease');
    latest = value;
  }
  if (token.confidence !== undefined && (typeof token.confidence !== 'number'
    || !Number.isFinite(token.confidence) || token.confidence < 0 || token.confidence > 1)) {
    fail('observation token confidence must be finite and between 0 and 1');
  }
  return latest;
}

/** Validates a producer-neutral observation without modifying it. */
export function validateObservation(observation: RecitationObservation): void {
  if (!isRecord(observation)) fail('observation must be an object');
  requireNonEmptyString(observation.observationId, 'observation id');
  requireStringLength(
    observation.observationId,
    OBSERVATION_LIMITS.maxObservationIdLength,
    'observation id',
  );
  if (!Number.isSafeInteger(observation.sourceRevision) || observation.sourceRevision < 0) {
    fail('source revision must be a non-negative integer');
  }
  if (typeof observation.isFinal !== 'boolean') fail('observation isFinal must be a boolean');
  requireFiniteTimestamp(observation.receivedAtMs, 'observation receivedAtMs');
  if (!Array.isArray(observation.tokens)) fail('observation tokens must be an array');
  if (observation.tokens.length > OBSERVATION_LIMITS.maxTokens) {
    fail(`observation must contain at most ${OBSERVATION_LIMITS.maxTokens} tokens`);
  }
  if (!observation.isFinal && observation.tokens.length === 0) fail('partial observation must contain at least one token');

  const tokenIds = new Set<string>();
  let phonemeCount = 0;
  let lastTimestamp: number | undefined;
  for (const token of observation.tokens) {
    if (!isRecord(token)) fail('observation token must be an object');
    requireNonEmptyString(token.id, 'observation token id');
    if (tokenIds.has(token.id)) fail('duplicate token id');
    tokenIds.add(token.id);
    validateObservationToken(token, lastTimestamp);
    phonemeCount += (token.phonemes as readonly string[]).length;
    if (phonemeCount > OBSERVATION_LIMITS.maxPhonemes) {
      fail(`observation must contain at most ${OBSERVATION_LIMITS.maxPhonemes} phonemes`);
    }
    const tokenEnd = typeof token.endMs === 'number'
      ? token.endMs
      : typeof token.startMs === 'number'
        ? token.startMs
        : undefined;
    if (tokenEnd !== undefined) lastTimestamp = tokenEnd;
  }
}
