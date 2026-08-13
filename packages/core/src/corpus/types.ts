/**
 * Canonical Qur’an corpus address and index contracts.
 *
 * @license Apache-2.0
 */

export type QuranLocation = Readonly<{
  surah: number;
  ayah: number;
  word: number;
  symbol: number;
}>;

export type QuranSymbol = Readonly<{
  id: string;
  text: string;
  phoneme: string;
  location: QuranLocation;
}>;

export type QuranWord = Readonly<{
  id: string;
  text: string;
  symbolIds: readonly string[];
  location: Omit<QuranLocation, 'symbol'>;
}>;

export type QuranCorpus = Readonly<{
  corpusId: string;
  revision: string;
  symbols: readonly QuranSymbol[];
  words: readonly QuranWord[];
}>;

export type CorpusRange = Readonly<{
  start: number;
  end: number;
}>;

/**
 * Read-only lookup structures derived from a validated canonical corpus.
 * Ranges use zero-based, end-exclusive positions in `symbols`.
 */
export type IndexedCorpus = Readonly<{
  symbolsById: ReadonlyMap<string, QuranSymbol>;
  wordsById: ReadonlyMap<string, QuranWord>;
  symbols: readonly QuranSymbol[];
  wordSymbolRanges: ReadonlyMap<string, CorpusRange>;
  ayahSymbolRanges: ReadonlyMap<string, CorpusRange>;
  phonemeNgramPostings: ReadonlyMap<string, readonly number[]>;
}>;
