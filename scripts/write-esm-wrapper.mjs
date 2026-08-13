import { readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const cjsPath = resolve(process.argv[2] ?? '');
const esmPath = resolve(process.argv[3] ?? '');

if (!process.argv[2] || !process.argv[3]) {
  throw new TypeError('usage: node scripts/write-esm-wrapper.mjs <input.cjs> <output.mjs>');
}

const cjsSource = await readFile(cjsPath, 'utf8');
const exportNames = new Set();
for (const match of cjsSource.matchAll(/\bexports\.([$A-Z_a-z][$\w]*)\s*=/gu)) {
  exportNames.add(match[1]);
}
for (const match of cjsSource.matchAll(
  /Object\.defineProperty\(exports,\s*["']([$A-Z_a-z][$\w]*)["']/gu,
)) {
  exportNames.add(match[1]);
}
const runtimeExports = [...exportNames].filter((name) => name !== 'default').sort();

if (runtimeExports.length === 0) {
  throw new TypeError(`no named CommonJS exports found in ${cjsPath}`);
}

for (const name of runtimeExports) {
  if (!/^[$A-Z_a-z][$\w]*$/u.test(name)) {
    throw new TypeError(`cannot create an ESM named export for ${JSON.stringify(name)}`);
  }
}

const cjsSpecifier = `./${basename(cjsPath)}`;
const wrapper = [
  `import qaraaExports from ${JSON.stringify(cjsSpecifier)};`,
  '',
  `const { ${runtimeExports.join(', ')} } = qaraaExports;`,
  '',
  `export { ${runtimeExports.join(', ')} };`,
  '',
].join('\n');

await writeFile(esmPath, wrapper);
await rm(resolve(dirname(esmPath), `${basename(esmPath)}.map`), { force: true });
