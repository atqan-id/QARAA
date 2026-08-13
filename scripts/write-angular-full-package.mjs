import { copyFile, readFile, writeFile } from 'node:fs/promises';

const root = new URL('../packages/angular/', import.meta.url);
const full = new URL('.full/index.js', root);
const bundle = new URL('dist/fesm2022/atqan-qaraa-angular.mjs', root);
const metadata = new URL('dist/package.json', root);

await copyFile(full, bundle);
const packageJson = JSON.parse(await readFile(metadata, 'utf8'));
delete packageJson.scripts;
await writeFile(metadata, `${JSON.stringify(packageJson, null, 2)}\n`);
