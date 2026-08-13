/** @license Apache-2.0 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareResults } from './compare-conformance-results.mjs';

const base = {
  language: 'python', sdkVersion: '0.1.0', protocolVersion: 1,
  cases: [{ fixture: 'valid/observation-submit.json', decoded: { sourceRevision: 1, retryable: false }, roundTrip: { sourceRevision: 1, retryable: false }, errorCode: null }],
};

test('reports exact semantic mismatch paths', () => {
  const other = structuredClone(base);
  other.language = 'go';
  delete other.cases[0].decoded.sourceRevision;
  other.cases[0].roundTrip.retryable = true;
  assert.deepEqual(compareResults([base, other]), [
    'go: valid/observation-submit.json.decoded.sourceRevision is missing',
    'go: valid/observation-submit.json.roundTrip.retryable expected false, received true',
  ]);
});

test('rejects duplicate and unknown fixture rows', async () => {
  const duplicate = structuredClone(base);
  duplicate.cases.push(structuredClone(duplicate.cases[0]));
  assert.throws(() => compareResults([duplicate]), /duplicate fixture/);
  const directory = await mkdtemp(join(tmpdir(), 'qaraa-conformance-'));
  const manifest = join(directory, 'manifest.json');
  await writeFile(manifest, JSON.stringify([{ file: 'known.json' }]));
  assert.throws(() => compareResults([base], { manifest }), /unknown fixture/);
  const missing = structuredClone(base); missing.cases=[];
  assert.throws(() => compareResults([missing], { manifest }), /missing fixture known.json/);
});
