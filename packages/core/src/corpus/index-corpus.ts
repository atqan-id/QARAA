/**
 * Immutable lookup indexes for a validated canonical corpus.
 *
 * @license Apache-2.0
 */

import { validateCorpus } from './validate.ts';
import type { CorpusRange, IndexedCorpus, QuranCorpus, QuranSymbol, QuranWord } from './types.ts';

class ImmutableMap<Key, Value> implements ReadonlyMap<Key, Value> {
  readonly #entries: Map<Key, Value>;

  constructor(entries: Iterable<readonly [Key, Value]>) {
    this.#entries = new Map(entries);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: Key): Value | undefined {
    return this.#entries.get(key);
  }

  has(key: Key): boolean {
    return this.#entries.has(key);
  }

  entries(): MapIterator<[Key, Value]> {
    return this.#entries.entries();
  }

  keys(): MapIterator<Key> {
    return this.#entries.keys();
  }

  values(): MapIterator<Value> {
    return this.#entries.values();
  }

  forEach(callbackfn: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown): void {
    this.#entries.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }

  [Symbol.iterator](): MapIterator<[Key, Value]> {
    return this.#entries[Symbol.iterator]();
  }
}

function freezeRange(start: number, end: number): CorpusRange {
  return Object.freeze({ start, end });
}

function copySymbol(symbol: QuranSymbol): QuranSymbol {
  return Object.freeze({
    id: symbol.id,
    text: symbol.text,
    phoneme: symbol.phoneme,
    location: Object.freeze({ ...symbol.location }),
  });
}

function copyWord(word: QuranWord): QuranWord {
  return Object.freeze({
    id: word.id,
    text: word.text,
    symbolIds: Object.freeze([...word.symbolIds]),
    location: Object.freeze({ ...word.location }),
  });
}

function addNgramPostings(symbols: readonly QuranSymbol[]): ReadonlyMap<string, readonly number[]> {
  const postings = new Map<string, number[]>();
  for (let start = 0; start < symbols.length; start += 1) {
    for (let length = 1; length <= 3 && start + length <= symbols.length; length += 1) {
      const key = symbols.slice(start, start + length).map(({ phoneme }) => phoneme).join(' ');
      const positions = postings.get(key);
      if (positions) positions.push(start);
      else postings.set(key, [start]);
    }
  }
  return new ImmutableMap([...postings].map(([key, positions]) => [key, Object.freeze(positions)]));
}

/**
 * Builds independent read-only lookup structures from a valid corpus.
 * The returned ranges are zero-based and end-exclusive.
 */
export function indexCorpus(corpus: QuranCorpus): IndexedCorpus {
  validateCorpus(corpus);

  const symbols = Object.freeze(corpus.symbols.map(copySymbol));
  const words = corpus.words.map(copyWord);
  const symbolsById = new ImmutableMap(symbols.map((symbol) => [symbol.id, symbol]));
  const wordsById = new ImmutableMap(words.map((word) => [word.id, word]));
  const symbolIndexes = new Map(symbols.map((symbol, index) => [symbol.id, index]));

  const wordSymbolRanges = new ImmutableMap(words.map((word) => {
    const firstSymbol = symbolIndexes.get(word.symbolIds[0]!);
    const lastSymbol = symbolIndexes.get(word.symbolIds[word.symbolIds.length - 1]!);
    return [word.id, freezeRange(firstSymbol!, lastSymbol! + 1)] as const;
  }));

  const ayahRanges = new Map<string, CorpusRange>();
  let start = 0;
  while (start < symbols.length) {
    const first = symbols[start]!;
    let end = start + 1;
    while (end < symbols.length
      && symbols[end]!.location.surah === first.location.surah
      && symbols[end]!.location.ayah === first.location.ayah) {
      end += 1;
    }
    ayahRanges.set(`${first.location.surah}:${first.location.ayah}`, freezeRange(start, end));
    start = end;
  }

  return Object.freeze({
    symbolsById,
    wordsById,
    symbols,
    wordSymbolRanges,
    ayahSymbolRanges: new ImmutableMap(ayahRanges),
    phonemeNgramPostings: addNgramPostings(symbols),
  });
}
