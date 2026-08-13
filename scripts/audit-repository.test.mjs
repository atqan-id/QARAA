/** @license Apache-2.0 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findInternalArtifactPaths, findInternalArtifacts } from './audit-repository.mjs';

test('rejects internal development artifacts from the public repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qaraa-repository-audit-'));
  await mkdir(join(root, '.superpowers', 'sdd'), { recursive: true });
  await mkdir(join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
  await writeFile(join(root, '.superpowers', 'sdd', 'report.md'), 'internal');
  await writeFile(join(root, 'docs', 'superpowers', 'plans', 'plan.md'), 'internal');
  await writeFile(join(root, 'README.md'), '# Public');

  assert.deepEqual(await findInternalArtifacts(root), [
    '.superpowers/sdd/report.md',
    'docs/superpowers/plans/plan.md',
  ]);
});

test('classifies only tracked internal paths', () => {
  assert.deepEqual(findInternalArtifactPaths([
    'README.md',
    '.superpowers/sdd/report.md',
    'docs/superpowers/plans/plan.md',
  ]), [
    '.superpowers/sdd/report.md',
    'docs/superpowers/plans/plan.md',
  ]);
});
