/** @license Apache-2.0 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditExamples } from './audit-examples.mjs';

test('example audit scans package-less examples without requiring a manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qaraa-examples-audit-'));
  await mkdir(join(root, 'native-example'), { recursive: true });
  await mkdir(join(root, 'new-js-example'), { recursive: true });
  await writeFile(join(root, 'native-example', 'main.py'), 'print("safe")\n');
  await writeFile(join(root, 'new-js-example', 'secret.ts'), 'api_key = "leaked"\n');

  assert.deepEqual(await auditExamples(root), [
    'new-js-example: secret-like source new-js-example/secret.ts',
  ]);
});
