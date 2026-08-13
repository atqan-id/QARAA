/**
 * Ensures private examples contain no publishable assets, models, or secrets.
 *
 * @license Apache-2.0
 */

import { access, readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const examplesDirectory = resolve(import.meta.dirname, '..', 'examples');
const forbiddenPath = /\.(?:bin|gguf|onnx|pt|safetensors|tflite)$/iu;
const forbiddenContent = /(?:api[_-]?key|secret|credential|password)\s*[:=]/iu;
const ignoredDirectories = new Set([
  'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.output',
  '.svelte-kit', '.astro', '.vite',
]);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : filesBelow(path);
    return entry.isFile() ? [path] : [];
  }));
  return nested.flat();
}

export async function auditExamples(root = examplesDirectory) {
  const errors = [];
  for (const example of await readdir(root, { withFileTypes: true })) {
    if (!example.isDirectory()) continue;
    const directory = resolve(root, example.name);
    const manifestPath = resolve(directory, 'package.json');
    if (await access(manifestPath).then(() => true, () => false)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.private !== true) errors.push(`${example.name}: example must be private`);
    }
    for (const file of await filesBelow(directory)) {
      const name = relative(root, file).replaceAll('\\', '/');
      if (forbiddenPath.test(file)) {
        errors.push(`${example.name}: model-like artifact ${name}`);
        continue;
      }
      if (/\.(?:ts|tsx|js|mjs|json)$/u.test(file)
        && forbiddenContent.test(await readFile(file, 'utf8'))) {
        errors.push(`${example.name}: secret-like source ${name}`);
      }
    }
  }
  return errors.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = await auditExamples();
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
}
