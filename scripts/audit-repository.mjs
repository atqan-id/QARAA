/** @license Apache-2.0 */
import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const internalRoots = ['.superpowers', 'docs/superpowers'];
const execFileAsync = promisify(execFile);

export function findInternalArtifactPaths(paths) {
  return paths.filter((path) => internalRoots.some((root) => (
    path === root || path.startsWith(`${root}/`)
  ))).sort();
}

async function walk(directory, output) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path, output);
    else if (entry.isFile()) output.push(path);
  }
}

export async function findInternalArtifacts(repositoryRoot) {
  const files = [];
  for (const root of internalRoots) await walk(resolve(repositoryRoot, root), files);
  return files
    .map((path) => relative(repositoryRoot, path).replaceAll('\\', '/'))
    .sort();
}

async function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const { stdout } = await execFileAsync('git', ['ls-files'], { cwd: repositoryRoot });
  const tracked = new Set(stdout.split('\n').filter(Boolean));
  const artifacts = (await findInternalArtifacts(repositoryRoot)).filter((path) => tracked.has(path));
  if (artifacts.length === 0) return;
  for (const artifact of artifacts) console.error(`Internal development artifact: ${artifact}`);
  process.exitCode = 1;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  await main();
}
