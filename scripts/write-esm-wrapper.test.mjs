import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'write-esm-wrapper.mjs');

test('discovers CJS exports without executing unavailable runtime dependencies', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'qaraa-esm-wrapper-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const cjsPath = join(directory, 'index.cjs');
  const esmPath = join(directory, 'index.mjs');
  await writeFile(cjsPath, `
    require('@qaraa/missing-during-focused-build');
    exports.directExport = 1;
    Object.defineProperty(exports, "getterExport", { enumerable: true, get: () => 2 });
  `);

  await execFileAsync(process.execPath, [scriptPath, cjsPath, esmPath]);

  assert.equal(
    await readFile(esmPath, 'utf8'),
    'import qaraaExports from "./index.cjs";\n\n'
      + 'const { directExport, getterExport } = qaraaExports;\n\n'
      + 'export { directExport, getterExport };\n',
  );
});
