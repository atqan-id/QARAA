import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readme = await readFile(resolve(root, 'README.md'), 'utf8');
const required = [
  '# QARAA',
  '## Why QARAA',
  '## Quick start',
  '## How it works',
  '## Packages',
  '## Design principles',
  '## Scope and non-goals',
  '## License and stewardship',
];
for (const heading of required) assert.ok(readme.includes(heading), `missing ${heading}`);
for (const link of readme.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/gu)) {
  await access(resolve(root, link[1]));
}
const closing = [
  '<p align="center">',
  'هَٰذَا مِن فَضْلِ رَبِّي<br>',
  'Hadza min fadli rabbi',
  '</p>',
].join('\n');
assert.ok(
  readme.trimEnd().endsWith(closing),
  'README must end with the exact centered Arabic and transliterated closing',
);
assert.doesNotMatch(readme, /King Saud University|KSU/iu);

console.log('README verification passed');
