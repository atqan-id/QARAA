/**
 * Removes declaration-map references when the bundler did not emit the maps.
 *
 * @license Apache-2.0
 */

import { readFile, writeFile } from 'node:fs/promises';

const declarationPaths = process.argv.slice(2);
if (declarationPaths.length === 0) throw new Error('at least one declaration path is required');

await Promise.all(declarationPaths.map(async (declarationPath) => {
  const declaration = await readFile(declarationPath, 'utf8');
  await writeFile(
    declarationPath,
    declaration.replace(/^\/\/# sourceMappingURL=.*(?:\r?\n)?/gmu, ''),
  );
}));
