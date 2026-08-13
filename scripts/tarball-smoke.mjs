import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  inspectPackList,
  inspectPackedContent,
  inspectRuntimeImports,
  inspectSourceMap,
} from './audit-package.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tscPath = resolve(repositoryRoot, 'node_modules/.bin/tsc');
const schemaSubpaths = [
  'command.schema.json',
  'corpus.schema.json',
  'error.schema.json',
  'event.schema.json',
  'observation.schema.json',
  'snapshot.schema.json',
];

const packages = [
  {
    directory: 'core',
    name: '@atqan/qaraa-core',
    internalDependencies: [],
    runtimeExports: [
      'OBSERVATION_LIMITS', 'alignPhonemes', 'classifyFinding', 'createReadingTracker', 'indexCorpus',
      'locateObservation', 'passesFinalFindingGate', 'passesImmediateFindingGate',
      'passesPositionGate', 'passesSoftFindingGate', 'scoreConfidence',
      'validateCorpus', 'validateObservation',
    ],
    typeExports: [
      'AlignmentCandidate', 'AlignmentMetricsSink', 'AlignmentOperation', 'AlignmentPath',
      'ConfidenceEvidence', 'ConfidenceInput', 'ConfirmedFinding', 'CorpusRange',
      'FindingClassificationInput', 'FindingConfirmation', 'FindingMode', 'IndexedCorpus',
      'ObservationToken', 'QuranCorpus', 'QuranLocation', 'QuranSymbol', 'QuranWord',
      'ReadingSnapshot', 'ReadingTracker', 'ReadingTrackerOptions', 'RecitationObservation',
      'SubstitutionOperation',
    ],
  },
  {
    directory: 'protocol',
    name: '@atqan/qaraa-protocol',
    internalDependencies: ['@atqan/qaraa-core'],
    runtimeExports: [
      'PROTOCOL_SCHEMAS', 'PROTOCOL_VERSION', 'QaraaProtocolError', 'SCHEMA_IDS',
      'assertValidCommand', 'assertValidCorpus', 'assertValidObservation', 'commandSchema', 'commandValidator',
      'corpusSchema', 'corpusValidator', 'errorSchema', 'errorValidator', 'eventSchema',
      'eventValidator', 'observationSchema', 'observationValidator', 'snapshotSchema',
      'snapshotValidator',
    ],
    typeExports: [
      'CommandEnvelope', 'EventEnvelope', 'JsonObject', 'JsonPrimitive', 'JsonValue',
      'ObservationSubmitCommand', 'ProtocolEnvelope', 'ProtocolVersion', 'QaraaCommand',
      'QaraaErrorCode', 'QaraaErrorEnvelope', 'QaraaEvent', 'SessionCreateCommand',
      'SessionCreatedEvent', 'SessionDeleteCommand', 'SessionDeletedEvent',
      'SessionGetCommand', 'SessionResetCommand', 'SessionResumeCommand',
      'SnapshotUpdatedEvent',
    ],
    schemaSubpaths,
  },
  {
    directory: 'client',
    name: '@atqan/qaraa-client',
    internalDependencies: ['@atqan/qaraa-core', '@atqan/qaraa-protocol'],
    runtimeExports: [
      'QaraaTransportError', 'createAdapterController', 'createLocalSession',
      'createRemoteSession',
    ],
    typeExports: [
      'LocalSessionOptions', 'QaraaFetch', 'QaraaFetchInit', 'QaraaFetchResponse',
      'QaraaSession', 'QaraaWebSocket', 'QaraaWebSocketCloseEvent',
      'QaraaWebSocketConstructor', 'QaraaWebSocketFactory', 'QaraaWebSocketListener',
      'QaraaWebSocketMessageEvent', 'RemoteRetryOptions', 'RemoteSessionOptions',
      'QaraaAdapterController', 'QaraaState', 'QaraaStateListener', 'QaraaStatus',
      'SnapshotListener',
    ],
  },
  {
    directory: 'server',
    name: '@atqan/qaraa-server',
    internalDependencies: ['@atqan/qaraa-core', '@atqan/qaraa-protocol'],
    runtimeExports: [
      'MemorySessionStore', 'SessionRecordExistsError', 'SessionRecordNotFoundError',
      'SessionService', 'createQaraaServer',
    ],
    typeExports: [
      'CorpusResolver', 'QaraaInjectOptions', 'QaraaInjectResponse', 'QaraaListenOptions',
      'QaraaServer', 'QaraaServerLogger', 'QaraaServerOptions', 'SessionRecord',
      'SessionServiceOptions', 'SessionSnapshotListener', 'SessionStore',
    ],
  },
  {
    directory: 'sherpa-onnx',
    name: '@atqan/qaraa-sherpa-onnx',
    internalDependencies: ['@atqan/qaraa-core'],
    runtimeExports: ['SherpaNormalizationError', 'normalizeSherpaResult'],
    typeExports: [
      'NormalizeSherpaResultOptions', 'NormalizedSherpaObservation',
      'SherpaNormalizationErrorCode', 'SherpaResultLike', 'TokenMapper',
    ],
  },
  ...[
    ['react', 'useQaraaSession'],
    ['preact', 'useQaraaSession'],
    ['vue', 'useQaraaSession'],
    ['angular', 'QaraaSessionService'],
    ['svelte', 'createQaraaStore'],
    ['solid', 'createQaraaSession'],
    ['lit', 'QaraaSessionController'],
  ].map(([directory, runtimeExport]) => ({
    directory,
    name: `@atqan/qaraa-${directory}`,
    internalDependencies: ['@atqan/qaraa-client', '@atqan/qaraa-core'],
    needsDomTypes: true,
    runtimeExports: [runtimeExport],
    typeExports: [],
    angularPackage: directory === 'angular',
  })),
];

const packageByName = new Map(packages.map((entry) => [entry.name, entry]));

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(path);
    return entry.isFile() ? [path] : [];
  }));
  return nested.flat();
}

async function packPackage(definition, tarballDirectory, extractionDirectory) {
  const packageDirectory = resolve(repositoryRoot, 'packages', definition.directory);
  const { stdout } = await execFileAsync('pnpm', [
    '--dir', packageDirectory, 'pack', '--json', '--pack-destination', tarballDirectory,
  ], { cwd: repositoryRoot, maxBuffer: 10 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  const packed = Array.isArray(result) ? result[0] : result;
  assert.equal(packed.name, definition.name);
  assert.equal(packed.version, '0.1.0');
  assert.equal(typeof packed.filename, 'string');

  const destination = join(extractionDirectory, definition.directory);
  await mkdir(destination, { recursive: true });
  await execFileAsync('tar', ['-xzf', packed.filename, '-C', destination]);
  const packageRoot = join(destination, 'package');
  assert.ok((await stat(packageRoot)).isDirectory());
  const fileNames = (await filesBelow(packageRoot))
    .map((file) => relative(packageRoot, file).replaceAll('\\', '/'));
  const packedFiles = new Set(fileNames);
  const violations = inspectPackList(packageDirectory, fileNames).map(({ message }) => message);
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));

  assert.equal(manifest.name, definition.name);
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.sideEffects, false);
  if (definition.angularPackage) {
    assert.equal(manifest.main, undefined);
    assert.equal(manifest.module, './dist/fesm2022/atqan-qaraa-angular.mjs');
    assert.equal(manifest.types, './dist/types/atqan-qaraa-angular.d.ts');
    assert.deepEqual(manifest.exports?.['.'], {
      types: './dist/types/atqan-qaraa-angular.d.ts',
      default: './dist/fesm2022/atqan-qaraa-angular.mjs',
    });
  } else {
    assert.equal(manifest.main, './dist/index.cjs');
    assert.equal(manifest.module, './dist/index.mjs');
    assert.equal(manifest.types, './dist/index.d.mts');
    assert.deepEqual(manifest.exports?.['.'], {
      import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
      require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
      default: './dist/index.mjs',
    });
  }

  for (const fileName of fileNames) {
    const content = await readFile(join(packageRoot, fileName), 'utf8');
    violations.push(...inspectPackedContent(fileName, content).map(({ reason }) => (
      `${definition.name}: ${reason} in ${fileName}`
    )));
    if (!fileName.startsWith('dist/')) continue;
    if (fileName.endsWith('.map')) {
      violations.push(...inspectSourceMap(fileName, content, repositoryRoot).map(({ reason }) => (
        `${definition.name}: ${reason} in ${fileName}`
      )));
    }
    if (fileName.endsWith('.mjs') || fileName.endsWith('.cjs')) {
      violations.push(...inspectRuntimeImports(definition.name, manifest, content, fileName));
    }
    if (!fileName.endsWith('.map')) {
      for (const match of content.matchAll(/[@#]\s*sourceMappingURL=([^\s*]+)/gu)) {
        const reference = match[1];
        if (!reference || reference.startsWith('data:')) continue;
        const target = posix.normalize(posix.join(posix.dirname(fileName), reference));
        if (!packedFiles.has(target)) {
          violations.push(`${definition.name}: missing sourceMappingURL target ${target} from ${fileName}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
  return packed.filename;
}

function dependencyClosure(definition) {
  const visited = new Map();
  function visit(entry) {
    if (visited.has(entry.name)) return;
    visited.set(entry.name, entry);
    for (const dependency of entry.internalDependencies) visit(packageByName.get(dependency));
  }
  visit(definition);
  return [...visited.values()];
}

function esmRuntimeSource(definition) {
  const schemaChecks = (definition.schemaSubpaths ?? []).map((schema) => {
    const variable = schema.replaceAll(/[^A-Za-z0-9]/gu, '_');
    return `const ${variable} = await import(${JSON.stringify(`${definition.name}/schemas/v1/${schema}`)}, { with: { type: 'json' } });\nassert.equal(typeof ${variable}.default, 'object');`;
  }).join('\n');
  return `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const expected = ${JSON.stringify(definition.runtimeExports)};
const imported = await import(${JSON.stringify(definition.name)});
const require = createRequire(import.meta.url);
const required = ${definition.angularPackage ? 'imported' : `require(${JSON.stringify(definition.name)})`};
assert.deepEqual(Object.keys(imported).sort(), expected);
assert.deepEqual(Object.keys(required).sort(), expected);
assert.match(import.meta.resolve(${JSON.stringify(definition.name)}), /\\.mjs$/u);
${definition.angularPackage ? '' : `assert.match(require.resolve(${JSON.stringify(definition.name)}), /\\.cjs$/u);`}
for (const name of expected) assert.equal(imported[name], required[name]);
${schemaChecks}
`;
}

function cjsRuntimeSource(definition) {
  const schemaChecks = (definition.schemaSubpaths ?? []).map((schema) => `assert.equal(typeof require(${JSON.stringify(`${definition.name}/schemas/v1/${schema}`)}), 'object');`).join('\n');
  return `
const assert = require('node:assert/strict');
const expected = ${JSON.stringify(definition.runtimeExports)};
const imported = require(${JSON.stringify(definition.name)});
assert.deepEqual(Object.keys(imported).sort(), expected);
assert.match(require.resolve(${JSON.stringify(definition.name)}), /\\.cjs$/u);
${schemaChecks}
`;
}

function typescriptSource(definition, format) {
  const runtime = format === 'esm'
    ? `import { ${definition.runtimeExports.join(', ')} } from ${JSON.stringify(definition.name)};\nvoid [${definition.runtimeExports.join(', ')}];`
    : `import qaraa = require(${JSON.stringify(definition.name)});\nvoid qaraa;`;
  const typeImports = definition.typeExports.length === 0 ? '' : `
import type {
  ${definition.typeExports.join(',\n  ')},
} from ${JSON.stringify(definition.name)};
type PublicTypes = [${definition.typeExports.join(', ')}];
declare const publicTypes: PublicTypes;
void publicTypes;`;
  const schemaImport = definition.schemaSubpaths
    ? format === 'esm'
      ? `import protocolSchemaAsset from ${JSON.stringify(`${definition.name}/schemas/v1/corpus.schema.json`)} with { type: 'json' };\nvoid protocolSchemaAsset;`
      : `import protocolSchemaAsset = require(${JSON.stringify(`${definition.name}/schemas/v1/corpus.schema.json`)});\nvoid protocolSchemaAsset;`
    : '';
  return `${runtime}\n${typeImports}\n${schemaImport}\n`;
}

async function smokeConsumer(definition, format, tarballs, workingDirectory) {
  const projectDirectory = join(workingDirectory, `${definition.directory}-${format}`);
  await mkdir(projectDirectory, { recursive: true });
  const dependencies = Object.fromEntries(dependencyClosure(definition).map((entry) => [
    entry.name, `file:${tarballs.get(entry.name)}`,
  ]));
  if (definition.angularPackage) {
    dependencies['@angular/core'] = '22.1.1';
    dependencies.rxjs = '7.8.2';
  }
  await writeFile(join(projectDirectory, 'package.json'), `${JSON.stringify({
    private: true,
    packageManager: 'pnpm@11.21.0',
    type: format === 'esm' ? 'module' : 'commonjs',
    dependencies,
  }, null, 2)}\n`);
  await execFileAsync('npm', [
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
  ], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      npm_config_cache: join(workingDirectory, 'npm-cache'),
      npm_config_update_notifier: 'false',
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  const runtimeFile = join(projectDirectory, format === 'esm' ? 'smoke.mjs' : 'smoke.cjs');
  await writeFile(runtimeFile, format === 'esm'
    ? esmRuntimeSource(definition)
    : cjsRuntimeSource(definition));
  await execFileAsync(process.execPath, [runtimeFile], { cwd: projectDirectory });

  await writeFile(join(projectDirectory, 'consumer.ts'), typescriptSource(definition, format));
  await writeFile(join(projectDirectory, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      lib: definition.needsDomTypes ? ['ES2022', 'DOM', 'DOM.Iterable'] : ['ES2022'],
      types: [],
      resolveJsonModule: true,
      skipLibCheck: false,
      noEmit: true,
    },
    include: ['consumer.ts'],
  }, null, 2)}\n`);
  await execFileAsync(tscPath, ['--project', 'tsconfig.json'], {
    cwd: projectDirectory,
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function main() {
  const { stdout: compilerVersion } = await execFileAsync(tscPath, ['--version']);
  assert.equal(compilerVersion.trim(), 'Version 7.0.2');

  const workingDirectory = await mkdtemp(join(tmpdir(), 'qaraa-tarball-smoke-'));
  const tarballDirectory = join(workingDirectory, 'tarballs');
  const extractionDirectory = join(workingDirectory, 'extracted');
  await mkdir(tarballDirectory, { recursive: true });
  await mkdir(extractionDirectory, { recursive: true });

  try {
    const tarballs = new Map();
    for (const definition of packages) {
      tarballs.set(definition.name, await packPackage(definition, tarballDirectory, extractionDirectory));
    }
    for (const definition of packages) {
      await smokeConsumer(definition, 'esm', tarballs, workingDirectory);
      if (!definition.angularPackage) await smokeConsumer(definition, 'cjs', tarballs, workingDirectory);
      process.stdout.write(`smoked ${definition.name}\n`);
    }
    process.stdout.write(`tarball smoke passed for ${packages.length} packages in their declared module formats\n`);
  } finally {
    if (process.env.QARAA_KEEP_TARBALL_TEMP !== '1') {
      await rm(workingDirectory, { force: true, recursive: true });
    } else {
      process.stdout.write(`kept tarball smoke workspace: ${workingDirectory}\n`);
    }
  }
}

await main();
