/**
 * Verifies canonical/package schema equality and fixture conformance.
 *
 * @license Apache-2.0
 */

import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = resolve(scriptDirectory, '..');
const protocolRequire = createRequire(resolve(rootDirectory, 'packages/protocol/package.json'));
const Ajv2020 = protocolRequire('ajv/dist/2020').default;
const execFileAsync = promisify(execFile);
const typeScriptCompiler = resolve(rootDirectory, 'node_modules/.bin/tsc');

const schemaFiles = {
  corpus: 'corpus.schema.json',
  observation: 'observation.schema.json',
  snapshot: 'snapshot.schema.json',
  command: 'command.schema.json',
  event: 'event.schema.json',
  error: 'error.schema.json',
};

const errorCodes = new Set([
  'INVALID_CORPUS',
  'INVALID_OBSERVATION',
  'STALE_REVISION',
  'UNSUPPORTED_PROTOCOL',
  'SESSION_NOT_FOUND',
  'INTERNAL_ERROR',
]);

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${path}: ${error.message}`, { cause: error });
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
}

function schemaFingerprint(value) {
  return JSON.stringify(canonicalJson(value));
}

function fixturePath(fixtureDirectory, file) {
  const path = resolve(fixtureDirectory, file);
  const fromDirectory = relative(fixtureDirectory, path);
  if (fromDirectory === '' || isAbsolute(fromDirectory) || fromDirectory === '..'
    || fromDirectory.startsWith(`..${sep}`)) {
    throw new Error(`Fixture escapes the conformance directory: ${file}`);
  }
  return path;
}

function assertManifestRow(row, index) {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error(`Manifest row ${index} must be an object`);
  }
  const unknownKeys = Object.keys(row).filter((key) => !['file', 'schema', 'valid', 'errorCode'].includes(key));
  if (unknownKeys.length > 0) throw new Error(`Manifest row ${index} has unknown fields: ${unknownKeys.join(', ')}`);
  if (typeof row.file !== 'string' || row.file.length === 0) throw new Error(`Manifest row ${index} needs file`);
  if (!(row.schema in schemaFiles)) throw new Error(`Manifest row ${index} has unknown schema: ${row.schema}`);
  if (typeof row.valid !== 'boolean') throw new Error(`Manifest row ${index} needs boolean valid`);
  if (row.errorCode !== undefined && !errorCodes.has(row.errorCode)) {
    throw new Error(`Manifest row ${index} has unknown error code: ${row.errorCode}`);
  }
}

/**
 * Detects drift between canonical and package-exported schema copies, then
 * compiles the canonical set and checks every language-neutral fixture.
 */
export async function verifySchemaSync({
  canonicalSchemaDirectory = resolve(rootDirectory, 'schemas/v1'),
  packageSchemaDirectory = resolve(rootDirectory, 'packages/protocol/src/schemas/v1'),
  fixtureDirectory = resolve(rootDirectory, 'conformance/v1'),
  typeSyncProject = resolve(rootDirectory, 'packages/protocol/tsconfig.type-sync.json'),
} = {}) {
  const canonicalFiles = (await readdir(canonicalSchemaDirectory)).filter((file) => file.endsWith('.schema.json')).sort();
  const packageFiles = (await readdir(packageSchemaDirectory)).filter((file) => file.endsWith('.schema.json')).sort();
  const expectedFiles = Object.values(schemaFiles).sort();
  if (schemaFingerprint(canonicalFiles) !== schemaFingerprint(expectedFiles)) {
    throw new Error(`Canonical schema set drift: expected ${expectedFiles.join(', ')}, received ${canonicalFiles.join(', ')}`);
  }
  if (schemaFingerprint(packageFiles) !== schemaFingerprint(expectedFiles)) {
    throw new Error(`Package schema set drift: expected ${expectedFiles.join(', ')}, received ${packageFiles.join(', ')}`);
  }

  const schemas = {};
  for (const [name, file] of Object.entries(schemaFiles)) {
    const canonical = await readJson(resolve(canonicalSchemaDirectory, file));
    const packaged = await readJson(resolve(packageSchemaDirectory, file));
    if (schemaFingerprint(canonical) !== schemaFingerprint(packaged)) {
      throw new Error(`Schema drift detected for ${file}`);
    }
    const expectedId = `urn:atqan:qaraa:protocol:v1:${name}`;
    if (canonical.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      throw new Error(`${file} is not Draft 2020-12`);
    }
    if (canonical.$id !== expectedId) throw new Error(`${file} must use absolute ID ${expectedId}`);
    schemas[name] = canonical;
  }

  const ajv = new Ajv2020({ allErrors: true, removeAdditional: false, strict: true });
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => {
    const validator = ajv.getSchema(schema.$id);
    if (!validator) throw new Error(`AJV did not compile ${name}`);
    return [name, validator];
  }));

  const manifest = await readJson(resolve(fixtureDirectory, 'manifest.json'));
  if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('Conformance manifest must be a non-empty array');
  const coveredErrorCodes = new Set();
  for (const [index, row] of manifest.entries()) {
    assertManifestRow(row, index);
    const payload = await readJson(fixturePath(fixtureDirectory, row.file));
    const validator = validators[row.schema];
    const actual = validator(payload);
    if (actual !== row.valid) {
      throw new Error(`${row.file} expected valid=${row.valid}: ${JSON.stringify(validator.errors)}`);
    }
    const isValidErrorEnvelope = row.valid
      && (row.schema === 'error' || (row.schema === 'event' && payload?.type === 'error'));
    if (isValidErrorEnvelope) {
      if (row.errorCode !== payload.code) {
        throw new Error(
          `${row.file} error code annotation ${row.errorCode ?? '(missing)'} does not match payload ${payload.code}`,
        );
      }
      coveredErrorCodes.add(payload.code);
    }
  }

  for (const code of errorCodes) {
    if (!coveredErrorCodes.has(code)) throw new Error(`Conformance manifest does not cover error code ${code}`);
  }

  try {
    await execFileAsync(typeScriptCompiler, ['--noEmit', '-p', typeSyncProject], {
      cwd: rootDirectory,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const diagnostics = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Type contract drift detected${diagnostics ? `:\n${diagnostics}` : ''}`, { cause: error });
  }

  return { schemaCount: Object.keys(schemas).length, fixtureCount: manifest.length };
}

async function main() {
  const result = await verifySchemaSync();
  console.log(`Schema sync verified: ${result.schemaCount} schemas, ${result.fixtureCount} fixtures.`);
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  await main();
}
