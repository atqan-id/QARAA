/**
 * Bounded local and posting-index candidate retrieval.
 *
 * @license Apache-2.0
 */

import type { IndexedCorpus } from '../corpus/types.ts';
import type { AlignmentMetricsSink } from './metrics.ts';

export const MAX_ALIGNMENT_CANDIDATES = 64;
const MAX_LOCAL_CANDIDATES = 48;
const FORWARD_PHONEME_COUNT = 3;
const MAX_NGRAM_QUERIES = 48;
const MAX_POSTING_INSPECTIONS = 128;
const MAX_ANCHOR_DISPLACEMENT = 3;

type Anchor = Readonly<{
  length: number;
  offset: number;
  postings: readonly number[];
}>;

type PostingCursor = {
  anchor: Anchor;
  left: number;
  right: number;
};

type InspectionBudget = { remaining: number };

function compareAroundCursor(left: number, right: number, cursorSymbol: number): number {
  const distance = Math.abs(left - cursorSymbol) - Math.abs(right - cursorSymbol);
  if (distance !== 0) return distance;
  const leftForward = Math.max(0, left - cursorSymbol);
  const rightForward = Math.max(0, right - cursorSymbol);
  if (leftForward !== rightForward) return leftForward - rightForward;
  return left - right;
}

function localPositions(
  index: IndexedCorpus,
  cursorSymbol: number,
  metricsSink?: AlignmentMetricsSink,
): number[] {
  if (index.symbols.length === 0) return [];
  const cursor = Math.max(0, Math.min(cursorSymbol, index.symbols.length - 1));
  metricsSink?.recordCorpusSymbolAccess(cursor);
  const activeSymbol = index.symbols[cursor]!;
  const activeRange = index.ayahSymbolRanges.get(
    `${activeSymbol.location.surah}:${activeSymbol.location.ayah}`,
  );
  if (!activeRange) return [cursor];

  let previousSymbol;
  if (activeRange.start > 0) {
    metricsSink?.recordCorpusSymbolAccess(activeRange.start - 1);
    previousSymbol = index.symbols[activeRange.start - 1];
  }
  const previousRange = previousSymbol
    ? index.ayahSymbolRanges.get(
      `${previousSymbol.location.surah}:${previousSymbol.location.ayah}`,
    )
    : undefined;
  const positions: number[] = [];
  const selected = new Set<number>();
  const add = (position: number): void => {
    if (positions.length >= MAX_LOCAL_CANDIDATES
      || position < 0
      || position >= index.symbols.length
      || selected.has(position)) return;
    selected.add(position);
    positions.push(position);
  };

  add(cursor);
  if (previousRange) add(previousRange.end - 1);
  for (let offset = 0; offset < FORWARD_PHONEME_COUNT; offset += 1) {
    add(activeRange.end + offset);
  }

  let activeLeft = cursor - 1;
  let activeRight = cursor + 1;
  let previousRight = (previousRange?.end ?? 0) - 2;
  while (positions.length < MAX_LOCAL_CANDIDATES) {
    const sizeBefore = positions.length;
    if (activeLeft >= activeRange.start || activeRight < activeRange.end) {
      if (activeLeft < activeRange.start) {
        add(activeRight);
        activeRight += 1;
      } else if (activeRight >= activeRange.end) {
        add(activeLeft);
        activeLeft -= 1;
      } else if (compareAroundCursor(activeLeft, activeRight, cursor) <= 0) {
        add(activeLeft);
        activeLeft -= 1;
      } else {
        add(activeRight);
        activeRight += 1;
      }
    }
    if (previousRange && previousRight >= previousRange.start) {
      add(previousRight);
      previousRight -= 1;
    }
    if (positions.length === sizeBefore) break;
  }
  return positions;
}

function inspectedValue(
  values: readonly number[],
  index: number,
  budget: InspectionBudget,
  metricsSink?: AlignmentMetricsSink,
): number | undefined {
  if (budget.remaining <= 0) return undefined;
  budget.remaining -= 1;
  const value = values[index];
  if (value !== undefined) metricsSink?.recordCorpusSymbolAccess(value);
  return value;
}

function lowerBound(
  values: readonly number[],
  target: number,
  budget: InspectionBudget,
  metricsSink?: AlignmentMetricsSink,
): number | undefined {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    const value = inspectedValue(values, middle, budget, metricsSink);
    if (value === undefined) return undefined;
    if (value < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function createPostingCursor(
  anchor: Anchor,
  cursorSymbol: number,
  budget: InspectionBudget,
  metricsSink?: AlignmentMetricsSink,
): PostingCursor | undefined {
  const right = lowerBound(
    anchor.postings,
    cursorSymbol + anchor.offset,
    budget,
    metricsSink,
  );
  return right === undefined ? undefined : { anchor, left: right - 1, right };
}

function takeNearestPosting(
  cursor: PostingCursor,
  cursorSymbol: number,
  budget: InspectionBudget,
  metricsSink?: AlignmentMetricsSink,
): number | undefined {
  const { anchor } = cursor;
  if (cursor.left < 0 && cursor.right >= anchor.postings.length) return undefined;
  const leftPosting = cursor.left >= 0
    ? inspectedValue(anchor.postings, cursor.left, budget, metricsSink)
    : undefined;
  if (cursor.left >= 0 && leftPosting === undefined) return undefined;
  const rightPosting = cursor.right < anchor.postings.length
    ? inspectedValue(anchor.postings, cursor.right, budget, metricsSink)
    : undefined;
  if (cursor.right < anchor.postings.length && rightPosting === undefined) return undefined;
  const leftPosition = leftPosting === undefined ? undefined : leftPosting - anchor.offset;
  const rightPosition = rightPosting === undefined ? undefined : rightPosting - anchor.offset;
  const takeLeft = rightPosition === undefined || (leftPosition !== undefined
    && compareAroundCursor(leftPosition, rightPosition, cursorSymbol) <= 0);
  if (takeLeft) {
    cursor.left -= 1;
    return leftPosting;
  }
  cursor.right += 1;
  return rightPosting;
}

function addStart(candidates: Set<number>, symbolCount: number, start: number): void {
  if (candidates.size < MAX_ALIGNMENT_CANDIDATES && start >= 0 && start < symbolCount) {
    candidates.add(start);
  }
}

function addDisplacedStarts(
  candidates: Set<number>,
  symbolCount: number,
  posting: number,
  actualOffset: number,
): void {
  const base = posting - actualOffset;
  for (let distance = 1;
    distance <= MAX_ANCHOR_DISPLACEMENT && candidates.size < MAX_ALIGNMENT_CANDIDATES;
    distance += 1) {
    addStart(candidates, symbolCount, base + distance);
    addStart(candidates, symbolCount, base - distance);
  }
}

function sampledOffsets(count: number, budget: number): readonly number[] {
  if (count <= budget) return Array.from({ length: count }, (_, offset) => offset);
  if (budget === 1) return [0];
  return Array.from({ length: budget }, (_, sample) => (
    Math.floor(sample * (count - 1) / (budget - 1))
  ));
}

function queryAnchors(
  index: IndexedCorpus,
  actualPhonemes: readonly string[],
): readonly Anchor[] {
  const maximumLength = Math.min(FORWARD_PHONEME_COUNT, actualPhonemes.length);
  const perLengthBudget = Math.floor(MAX_NGRAM_QUERIES / maximumLength);
  const anchors: Anchor[] = [];
  let queryCount = 0;
  for (let length = maximumLength; length >= 1; length -= 1) {
    const offsetCount = actualPhonemes.length - length + 1;
    for (const offset of sampledOffsets(offsetCount, perLengthBudget)) {
      if (queryCount >= MAX_NGRAM_QUERIES) break;
      queryCount += 1;
      const key = actualPhonemes.slice(offset, offset + length).join(' ');
      const postings = index.phonemeNgramPostings.get(key);
      if (postings && postings.length > 0) anchors.push({ length, offset, postings });
    }
  }
  anchors.sort((left, right) => (
    left.postings.length - right.postings.length
    || right.length - left.length
    || left.offset - right.offset
  ));
  return anchors;
}

function addGlobalCandidates(
  candidates: Set<number>,
  index: IndexedCorpus,
  actualPhonemes: readonly string[],
  cursorSymbol: number,
  metricsSink?: AlignmentMetricsSink,
): void {
  const anchors = queryAnchors(index, actualPhonemes);
  const budget: InspectionBudget = { remaining: MAX_POSTING_INSPECTIONS };
  const cursors: PostingCursor[] = [];
  const nearest: { cursor: PostingCursor; posting: number }[] = [];

  // Give each rarity-ordered anchor one exact-offset hypothesis first.
  for (const anchor of anchors) {
    if (candidates.size >= MAX_ALIGNMENT_CANDIDATES || budget.remaining <= 0) break;
    const cursor = createPostingCursor(anchor, cursorSymbol, budget, metricsSink);
    if (!cursor) break;
    cursors.push(cursor);
    const posting = takeNearestPosting(cursor, cursorSymbol, budget, metricsSink);
    if (posting !== undefined) {
      nearest.push({ cursor, posting });
      addStart(candidates, index.symbols.length, posting - anchor.offset);
    }
  }

  // Account for bounded insertion/deletion displacement before each anchor.
  for (const { cursor, posting } of nearest) {
    if (candidates.size >= MAX_ALIGNMENT_CANDIDATES) break;
    addDisplacedStarts(
      candidates,
      index.symbols.length,
      posting,
      cursor.anchor.offset,
    );
  }

  // Fill spare capacity fairly across lists. Inspections remain bounded even
  // when every translated start is invalid or already present.
  while (candidates.size < MAX_ALIGNMENT_CANDIDATES && budget.remaining > 0) {
    const remainingBefore = budget.remaining;
    for (const cursor of cursors) {
      if (candidates.size >= MAX_ALIGNMENT_CANDIDATES || budget.remaining <= 0) break;
      const posting = takeNearestPosting(cursor, cursorSymbol, budget, metricsSink);
      if (posting === undefined) continue;
      addStart(
        candidates,
        index.symbols.length,
        posting - cursor.anchor.offset,
      );
      addDisplacedStarts(
        candidates,
        index.symbols.length,
        posting,
        cursor.anchor.offset,
      );
    }
    if (budget.remaining === remainingBefore) break;
  }
}

/**
 * Retrieves a deterministic candidate set. Global lookup reads only the
 * precomputed one-to-three-phoneme posting lists and never scans all symbols.
 */
export function retrieveCandidatePositions(
  index: IndexedCorpus,
  actualPhonemes: readonly string[],
  cursorSymbol: number,
  includeGlobal: boolean,
  metricsSink?: AlignmentMetricsSink,
): readonly number[] {
  const candidates = new Set(localPositions(index, cursorSymbol, metricsSink));
  if (includeGlobal && actualPhonemes.length > 0) {
    addGlobalCandidates(candidates, index, actualPhonemes, cursorSymbol, metricsSink);
  }

  return Object.freeze([...candidates].slice(0, MAX_ALIGNMENT_CANDIDATES));
}
