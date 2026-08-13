/** Rejects forbidden implementation boundaries in published framework adapters. @license Apache-2.0 */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const names = ['react', 'preact', 'vue', 'angular', 'svelte', 'solid', 'lit'];
const frameworkNames = new Set(names);
const forbiddenSource = /(?:@atqan\/qaraa-(?:server|sherpa-onnx)|alignPhonemes|locateObservation|createReadingTracker|indexCorpus|createLocalSession|createRemoteSession|\b(?:window|document|navigator|fetch|WebSocket|setTimeout|setInterval)\b|\.css['"])/u;
const packageImport = /@atqan\/qaraa-([a-z-]+)/gu;
const root = resolve(import.meta.dirname, '..');
let failed = false;

for (const name of names) {
  for (const kind of ['src', 'dist']) {
    const directory = resolve(root, 'packages', name, kind);
    let entries;
    try {
      entries = await readdir(directory, { recursive: true });
    } catch {
      if (kind === 'dist') {
        console.error(`${name}: emitted bundle directory is missing; run the adapter build first`);
        failed = true;
      }
      continue;
    }
    for (const entry of entries) {
      if (!/\.(?:[cm]?js|ts)$/u.test(entry)) continue;
      const path = resolve(directory, entry);
      const source = await readFile(path, 'utf8');
      if (forbiddenSource.test(source)) {
        console.error(`${name}: forbidden adapter boundary in ${kind}/${entry}`);
        failed = true;
      }
      for (const match of source.matchAll(packageImport)) {
        const importedPackage = match[1];
        if (importedPackage !== name && frameworkNames.has(importedPackage)) {
          console.error(`${name}: ${kind}/${entry} imports sibling adapter @atqan/qaraa-${importedPackage}`);
          failed = true;
        }
      }
    }
  }
}

if (failed) process.exitCode = 1;
