/**
 * Structural Sherpa-ONNX normalization contract tests.
 *
 * @license Apache-2.0
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  normalizeSherpaResult,
  SherpaNormalizationError,
} from '../src/index.ts';

const execFileAsync = promisify(execFile);
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const options = {
  observationId: 'observation-7',
  sourceRevision: 3,
  isFinal: false,
  receivedAtMs: 1_000,
  tokenMapper(token: string) {
    if (token === '<blank>') return null;
    if (token === 'bi') return { text: 'بِ', phonemes: ['b', 'i'] };
    if (token === 'smi') return { text: 'سْمِ', phonemes: ['s', 'm', 'i'] };
    return undefined;
  },
};

test('normalizes structural tokens, seconds timestamps, and snake-case confidences', () => {
  const observation = normalizeSherpaResult({
    tokens: ['bi', '<blank>', 'smi'],
    timestamps: [0, 0.2, 0.65],
    ys_probs: [0.9, 0.1, 0.8],
  }, options);

  assert.deepEqual(observation, {
    observationId: 'observation-7',
    sourceRevision: 3,
    isFinal: false,
    receivedAtMs: 1_000,
    tokens: [
      { id: 'sherpa-0', text: 'بِ', phonemes: ['b', 'i'], startMs: 0, endMs: 200, confidence: 0.9 },
      { id: 'sherpa-2', text: 'سْمِ', phonemes: ['s', 'm', 'i'], startMs: 650, confidence: 0.8 },
    ],
  });
});

test('uses camel-case probabilities only when snake-case probabilities are absent', () => {
  const observation = normalizeSherpaResult({
    tokens: ['bi', 'smi'],
    ysProbs: [0.3, 0.7],
  }, options);

  assert.deepEqual(observation.tokens.map((token) => token.confidence), [0.3, 0.7]);
});

test('ignores an entire malformed probability array without changing mapped tokens', () => {
  const baseline = normalizeSherpaResult({ tokens: ['bi', 'smi'] }, options);
  const malformed = normalizeSherpaResult({
    tokens: ['bi', 'smi'],
    ys_probs: [0.6, Number.NaN],
    ysProbs: [0.4],
  }, options);

  assert.deepEqual(malformed, baseline);
});

test('ignores malformed timestamp data instead of producing a partially timed observation', () => {
  const baseline = normalizeSherpaResult({ tokens: ['bi', 'smi'] }, options);
  const malformed = normalizeSherpaResult({
    tokens: ['bi', 'smi'],
    timestamps: [0.5, 0.2],
  }, options);

  assert.deepEqual(malformed, baseline);
});

test('ignores a source-seconds timestamp decrease even when rounding would hide it', () => {
  const baseline = normalizeSherpaResult({ tokens: ['bi', 'smi'] }, options);
  const malformed = normalizeSherpaResult({
    tokens: ['bi', 'smi'],
    timestamps: [0.00049, 0.00048],
  }, options);

  assert.deepEqual(malformed, baseline);
});

test('rejects a non-ignored unknown token with the typed UNKNOWN_TOKEN error', () => {
  assert.throws(
    () => normalizeSherpaResult({ tokens: ['bi', 'unknown'] }, options),
    (error: unknown) => error instanceof SherpaNormalizationError
      && error.code === 'UNKNOWN_TOKEN'
      && error.token === 'unknown'
      && error.index === 1,
  );
});

test('rejects malformed structural input and required observation fields', () => {
  assert.throws(
    () => normalizeSherpaResult({ tokens: 'bi' }, options),
    (error: unknown) => error instanceof SherpaNormalizationError
      && error.code === 'INVALID_RESULT',
  );
  assert.throws(
    () => normalizeSherpaResult({ tokens: ['bi'] }, { ...options, receivedAtMs: -1 }),
    (error: unknown) => error instanceof SherpaNormalizationError
      && error.code === 'INVALID_OPTIONS',
  );
  for (const invalidOptions of [null, undefined, 1, 'options']) {
    assert.throws(
      () => normalizeSherpaResult({ tokens: ['bi'] }, invalidOptions as never),
      (error: unknown) => error instanceof SherpaNormalizationError
        && error.code === 'INVALID_OPTIONS',
    );
  }
});

test('copies and freezes every normalized observation boundary', () => {
  const mappedPhonemes = ['b', 'i'];
  const observation = normalizeSherpaResult({ tokens: ['bi'] }, {
    ...options,
    tokenMapper: () => ({ text: 'بِ', phonemes: mappedPhonemes }),
  });

  mappedPhonemes.push('mutated');
  assert.deepEqual(observation.tokens[0]?.phonemes, ['b', 'i']);
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(Object.isFrozen(observation.tokens), true);
  assert.equal(Object.isFrozen(observation.tokens[0]!), true);
  assert.equal(Object.isFrozen(observation.tokens[0]!.phonemes), true);
  assert.throws(() => { (observation.tokens as string[]).push('mutated'); }, TypeError);
  assert.throws(() => { (observation.tokens[0] as { text: string }).text = 'mutated'; }, TypeError);
  assert.throws(() => { (observation.tokens[0]!.phonemes as string[]).push('mutated'); }, TypeError);
});

test('packs every declaration source map referenced by the emitted declaration', async () => {
  await execFileAsync('pnpm', ['--dir', packageDirectory, 'run', 'build']);
  const { stdout } = await execFileAsync('pnpm', [
    '--dir',
    packageDirectory,
    'pack',
    '--dry-run',
    '--json',
  ]);
  const packed = JSON.parse(stdout);
  const pack = Array.isArray(packed) ? packed[0] : packed;
  const packedFiles = new Set(pack.files.map((file: string | { path: string }) => (
    typeof file === 'string' ? file : file.path
  )).map((fileName: string) => fileName.replace(/^package\//u, '')));
  const declaration = await readFile(resolve(packageDirectory, 'dist/index.d.mts'), 'utf8');
  const references = [...declaration.matchAll(/^\/\/# sourceMappingURL=(.+)$/gmu)]
    .map((match) => `dist/${match[1]!}`);

  assert.deepEqual(references.filter((fileName) => !packedFiles.has(fileName)), []);
});
