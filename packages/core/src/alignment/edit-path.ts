/**
 * Deterministic edit-path alignment for phoneme sequences.
 *
 * @license Apache-2.0
 */

import type { AlignmentOperation, AlignmentPath } from './types.ts';
import type { AlignmentMetricsSink } from './metrics.ts';

const MATCH = 1;
const SUBSTITUTION = 2;
const DELETION = 3;
const INSERTION = 4;

export type AlignmentWorkspace = {
  readonly actualCapacity: number;
  readonly referenceCapacity: number;
  readonly directions: Uint8Array;
  readonly firstRow: Uint32Array;
  readonly secondRow: Uint32Array;
};

function freezeOperation(operation: AlignmentOperation): AlignmentOperation {
  return Object.freeze(operation);
}

/** Creates mutable DP storage intended to remain local to one invocation. */
export function createAlignmentWorkspace(
  actualCapacity: number,
  referenceCapacity: number,
): AlignmentWorkspace {
  return {
    actualCapacity,
    referenceCapacity,
    directions: new Uint8Array((actualCapacity + 1) * (referenceCapacity + 1)),
    firstRow: new Uint32Array(referenceCapacity + 1),
    secondRow: new Uint32Array(referenceCapacity + 1),
  };
}

/**
 * Aligns complete phoneme sequences without assuming that their raw indexes
 * still correspond after an insertion or deletion.
 */
export function alignPhonemes(
  actual: readonly string[],
  reference: readonly string[],
): AlignmentPath {
  return alignPhonemesWithWorkspace(
    actual,
    reference,
    createAlignmentWorkspace(actual.length, reference.length),
  );
}

/** Aligns with caller-owned workspace so bounded callers can reuse storage. */
export function alignPhonemesWithWorkspace(
  actual: readonly string[],
  reference: readonly string[],
  workspace: AlignmentWorkspace,
  metricsSink?: AlignmentMetricsSink,
): AlignmentPath {
  if (actual.length > workspace.actualCapacity
    || reference.length > workspace.referenceCapacity) {
    throw new RangeError('alignment workspace capacity exceeded');
  }
  const rowWidth = reference.length + 1;
  const { directions } = workspace;
  let previous = workspace.firstRow;
  let current = workspace.secondRow;

  previous[0] = 0;
  for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex += 1) {
    previous[referenceIndex] = referenceIndex;
    directions[referenceIndex] = DELETION;
  }

  for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
    current[0] = actualIndex;
    directions[actualIndex * rowWidth] = INSERTION;

    for (let referenceIndex = 1; referenceIndex <= reference.length; referenceIndex += 1) {
      metricsSink?.recordEditCell(actualIndex - 1, referenceIndex - 1);
      const offset = actualIndex * rowWidth + referenceIndex;
      if (actual[actualIndex - 1] === reference[referenceIndex - 1]) {
        current[referenceIndex] = previous[referenceIndex - 1]!;
        directions[offset] = MATCH;
        continue;
      }

      const substitution = previous[referenceIndex - 1]! + 1;
      const deletion = current[referenceIndex - 1]! + 1;
      const insertion = previous[referenceIndex]! + 1;
      const minimum = Math.min(substitution, deletion, insertion);
      current[referenceIndex] = minimum;
      directions[offset] = substitution === minimum
        ? SUBSTITUTION
        : deletion === minimum
          ? DELETION
          : INSERTION;
    }

    const swap = previous;
    previous = current;
    current = swap;
  }

  const reversed: AlignmentOperation[] = [];
  let actualIndex = actual.length;
  let referenceIndex = reference.length;
  while (actualIndex > 0 || referenceIndex > 0) {
    const direction = directions[actualIndex * rowWidth + referenceIndex];
    if (direction === MATCH) {
      actualIndex -= 1;
      referenceIndex -= 1;
      reversed.push(freezeOperation({
        kind: 'match',
        actualIndex,
        referenceIndex,
        score: 1,
      }));
    } else if (direction === SUBSTITUTION) {
      actualIndex -= 1;
      referenceIndex -= 1;
      reversed.push(freezeOperation({
        kind: 'substitution',
        actualIndex,
        referenceIndex,
        score: 0,
      }));
    } else if (direction === DELETION) {
      referenceIndex -= 1;
      reversed.push(freezeOperation({
        kind: 'deletion',
        actualIndex: null,
        referenceIndex,
        score: 0,
      }));
    } else {
      actualIndex -= 1;
      reversed.push(freezeOperation({
        kind: 'insertion',
        actualIndex,
        referenceIndex: null,
        score: 0,
      }));
    }
  }

  const operations = Object.freeze(reversed.reverse());
  const editCount = operations.reduce((count, operation) => (
    count + (operation.kind === 'match' ? 0 : 1)
  ), 0);
  const firstEdit = operations.findIndex(({ kind }) => kind !== 'match');
  let matchedLookaheadCount = 0;
  if (firstEdit >= 0) {
    for (let index = firstEdit + 1; index < operations.length; index += 1) {
      if (operations[index]!.kind !== 'match') break;
      matchedLookaheadCount += 1;
    }
  }
  const normalizer = Math.max(actual.length, reference.length);

  return Object.freeze({
    score: normalizer === 0 ? 1 : (normalizer - editCount) / normalizer,
    editCount,
    matchedLookaheadCount,
    operations,
  });
}
