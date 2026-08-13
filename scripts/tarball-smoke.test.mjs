import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('packed packages load and type-check in their declared module formats', { timeout: 360_000 }, () => {
  const result = spawnSync(process.execPath, ['scripts/tarball-smoke.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 350_000,
  });

  assert.equal(
    result.status,
    0,
    ['tarball smoke failed', result.stdout, result.stderr].filter(Boolean).join('\n'),
  );
  assert.match(result.stdout, /tarball smoke passed for 12 packages in their declared module formats/u);
});
