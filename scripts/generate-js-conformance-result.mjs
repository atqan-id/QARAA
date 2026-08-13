/** Validate fixtures through the actual protocol package and emit the TypeScript baseline. @license Apache-2.0 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertValidCorpus,
  commandValidator,
  corpusValidator,
  errorValidator,
  eventValidator,
  observationValidator,
  snapshotValidator,
} from '../packages/protocol/dist/index.mjs';

const validators = {
  command: commandValidator,
  corpus: corpusValidator,
  error: errorValidator,
  event: eventValidator,
  observation: observationValidator,
  snapshot: snapshotValidator,
};

export function validateFixture(entry, value) {
  const validator = validators[entry.schema];
  if (!validator) throw new TypeError(`unknown fixture schema ${entry.schema}`);
  let accepted;
  if (entry.schema === 'corpus') {
    try {
      assertValidCorpus(value);
      accepted = true;
    } catch {
      accepted = false;
    }
  } else {
    accepted = validator(value);
  }
  if (accepted !== entry.valid) {
    const expectation = entry.valid ? 'valid but failed' : 'invalid but passed';
    throw new Error(`${entry.file ?? entry.schema} marked ${expectation}`);
  }
  return accepted ? structuredClone(value) : null;
}

export async function generate(output, root = resolve('conformance/v1')) {
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const cases = [];
  for (const entry of manifest) {
    const value = JSON.parse(await readFile(resolve(root, entry.file), 'utf8'));
    const decoded = validateFixture(entry, value);
    cases.push({
      fixture: entry.file,
      decoded,
      roundTrip: decoded,
      errorCode: entry.errorCode ?? null,
    });
  }
  await writeFile(output, JSON.stringify({
    language: 'typescript',
    sdkVersion: '0.1.0',
    protocolVersion: 1,
    cases,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2];
  if (!output) throw new TypeError('output path required');
  await generate(output);
}
