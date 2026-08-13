import { existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testDirectory = resolve(packageDirectory, 'test');
const flagsWithValues = new Set([
  '--test-concurrency',
  '--test-coverage-branches',
  '--test-coverage-exclude',
  '--test-coverage-functions',
  '--test-coverage-include',
  '--test-coverage-lines',
  '--test-global-setup',
  '--test-isolation',
  '--test-name-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-rerun-failures',
  '--test-shard',
  '--test-skip-pattern',
  '--test-timeout',
]);

function isInsidePackage(path) {
  const pathFromPackage = relative(packageDirectory, path);
  return pathFromPackage !== ''
    && !isAbsolute(pathFromPackage)
    && pathFromPackage !== '..'
    && !pathFromPackage.startsWith(`..${sep}`);
}

function allTestPaths() {
  return readdirSync(testDirectory, { recursive: true })
    .filter((entry) => entry.endsWith('.test.ts'))
    .map((entry) => resolve(testDirectory, entry))
    .sort();
}

/** Maps package-test arguments to real paths under this package. */
export function resolveTestPaths(argumentsToResolve) {
  if (argumentsToResolve.length === 0) return allTestPaths();

  return argumentsToResolve.map((argument) => {
    const directPath = resolve(packageDirectory, argument);
    if (isInsidePackage(directPath) && existsSync(directPath)) return directPath;

    const nestedPath = resolve(testDirectory, argument);
    if (isInsidePackage(nestedPath) && existsSync(nestedPath)) return nestedPath;

    return directPath;
  });
}

function resolveTestSelector(argument) {
  const directPath = resolve(packageDirectory, argument);
  if (isInsidePackage(directPath) && existsSync(directPath)) {
    return { recognized: true, value: directPath };
  }

  const nestedPath = resolve(testDirectory, argument);
  if (isInsidePackage(nestedPath) && existsSync(nestedPath)) {
    return { recognized: true, value: nestedPath };
  }

  return { recognized: false, value: argument };
}

/** Preserves Node test-runner options while resolving only test selectors. */
export function resolveTestArguments(argumentsToResolve) {
  const resolvedArguments = [];
  let hasTestSelector = false;

  for (let index = 0; index < argumentsToResolve.length; index += 1) {
    const argument = argumentsToResolve[index];
    if (argument === '--') continue;
    if (argument.startsWith('-')) {
      resolvedArguments.push(argument);
      if (!argument.includes('=') && flagsWithValues.has(argument)) {
        const value = argumentsToResolve[index + 1];
        if (value !== undefined) {
          resolvedArguments.push(value);
          index += 1;
        }
      }
      continue;
    }

    const resolvedSelector = resolveTestSelector(argument);
    resolvedArguments.push(resolvedSelector.value);
    hasTestSelector ||= resolvedSelector.recognized;
  }

  return hasTestSelector ? resolvedArguments : [...resolvedArguments, ...allTestPaths()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync(process.execPath, ['--test', ...resolveTestArguments(process.argv.slice(2))], {
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
}
