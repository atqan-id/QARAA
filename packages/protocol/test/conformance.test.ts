/**
 * Language-neutral protocol v1 conformance tests.
 *
 * @license Apache-2.0
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import Ajv2020 from 'ajv/dist/2020.js';
import ts from 'typescript';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootDirectory = resolve(packageDirectory, '../..');
const execFileAsync = promisify(execFile);
const schemaDirectory = resolve(rootDirectory, 'schemas/v1');
const fixtureDirectory = resolve(rootDirectory, 'conformance/v1');

const schemaFiles = {
  corpus: 'corpus.schema.json',
  observation: 'observation.schema.json',
  snapshot: 'snapshot.schema.json',
  command: 'command.schema.json',
  event: 'event.schema.json',
  error: 'error.schema.json',
} as const;

type SchemaName = keyof typeof schemaFiles;
type ManifestRow = Readonly<{
  file: string;
  schema: SchemaName;
  valid: boolean;
  errorCode?: string;
}>;

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadSchemas(): Promise<Record<SchemaName, Record<string, unknown>>> {
  return Object.fromEntries(await Promise.all(Object.entries(schemaFiles).map(async ([name, file]) => (
    [name, await readJson(resolve(schemaDirectory, file))]
  )))) as Record<SchemaName, Record<string, unknown>>;
}

async function loadManifest(): Promise<readonly ManifestRow[]> {
  return await readJson(resolve(fixtureDirectory, 'manifest.json')) as readonly ManifestRow[];
}

function compileSchemas(schemas: Record<SchemaName, Record<string, unknown>>) {
  const ajv = new Ajv2020({ allErrors: true, removeAdditional: false, strict: true });
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  return Object.fromEntries(Object.entries(schemas).map(([name, schema]) => {
    const id = schema.$id;
    assert.equal(typeof id, 'string');
    const validator = ajv.getSchema(id);
    assert.ok(validator, `missing compiled validator for ${name}`);
    return [name, validator];
  })) as Record<SchemaName, ReturnType<typeof ajv.compile>>;
}

test('all conformance fixtures agree with strict Draft 2020-12 schemas', async () => {
  const schemas = await loadSchemas();
  const validators = compileSchemas(schemas);
  const manifest = await loadManifest();

  assert.ok(manifest.length > 0);
  for (const row of manifest) {
    assert.equal(typeof row.file, 'string');
    assert.ok(row.schema in schemaFiles, `${row.file} has unknown schema ${row.schema}`);
    assert.equal(typeof row.valid, 'boolean');
    const payload = await readJson(resolve(fixtureDirectory, row.file));
    assert.equal(
      validators[row.schema](payload),
      row.valid,
      `${row.file}: ${JSON.stringify(validators[row.schema].errors)}`,
    );
  }
});

test('schemas use absolute v1 URNs and reject unknown envelope and payload fields', async () => {
  const schemas = await loadSchemas();
  const validators = compileSchemas(schemas);

  for (const [name, schema] of Object.entries(schemas)) {
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(String(schema.$id), /^urn:atqan:qaraa:protocol:v1:[a-z-]+$/);
    assert.equal(schema.$id, `urn:atqan:qaraa:protocol:v1:${name}`);
  }

  const cases: readonly [SchemaName, string, (value: Record<string, unknown>) => void][] = [
    ['corpus', 'valid/minimal-corpus.json', (value) => {
      (value.symbols as Record<string, unknown>[])[0]!.unexpected = true;
    }],
    ['observation', 'valid/partial-observation.json', (value) => {
      (value.tokens as Record<string, unknown>[])[0]!.unexpected = true;
    }],
    ['snapshot', 'valid/reading-snapshot.json', (value) => {
      (value.display as Record<string, unknown>).unexpected = true;
    }],
    ['command', 'valid/session-create.json', (value) => {
      value.unexpected = true;
    }],
    ['event', 'valid/session-created-event.json', (value) => {
      value.unexpected = true;
    }],
    ['error', 'valid/error-envelope.json', (value) => {
      value.unexpected = true;
    }],
  ];

  for (const [schema, file, mutate] of cases) {
    const payload = structuredClone(await readJson(resolve(fixtureDirectory, file))) as Record<string, unknown>;
    mutate(payload);
    const payloadBeforeValidation = JSON.stringify(payload);
    assert.equal(validators[schema](payload), false, `${schema} accepted an unknown field`);
    assert.equal(JSON.stringify(payload), payloadBeforeValidation, `${schema} mutated the rejected payload`);
  }
});

test('manifest covers every command, event, error code, reconnect, Unicode, and missing optionals', async () => {
  const manifest = await loadManifest();
  const validPayloads = await Promise.all(manifest.filter((row) => row.valid).map(async (row) => (
    await readJson(resolve(fixtureDirectory, row.file)) as Record<string, unknown>
  )));
  const types = new Set(validPayloads.map((payload) => payload.type).filter((value) => typeof value === 'string'));
  assert.deepEqual(types, new Set([
    'session.create',
    'session.get',
    'session.reset',
    'session.delete',
    'observation.submit',
    'session.resume',
    'session.created',
    'snapshot.updated',
    'session.deleted',
    'error',
  ]));

  const validErrors = validPayloads.filter((payload) => payload.type === 'error');
  assert.deepEqual(new Set(validErrors.map((payload) => payload.code)), new Set([
    'INVALID_CORPUS',
    'INVALID_OBSERVATION',
    'STALE_REVISION',
    'UNSUPPORTED_PROTOCOL',
    'SESSION_NOT_FOUND',
    'INTERNAL_ERROR',
  ]));
  for (const row of manifest.filter((candidate) => candidate.valid && candidate.errorCode !== undefined)) {
    const payload = await readJson(resolve(fixtureDirectory, row.file)) as Record<string, unknown>;
    assert.equal(row.errorCode, payload.code, `${row.file} errorCode annotation disagrees with its payload`);
  }
  assert.ok(manifest.some((row) => row.file === 'valid/session-resume.json'));

  const unicodeText = await readFile(resolve(fixtureDirectory, 'valid/unicode-quran.json'), 'utf8');
  assert.match(unicodeText, /[\u0600-\u06ff]/u);

  const partial = await readJson(resolve(fixtureDirectory, 'valid/partial-observation.json')) as {
    tokens: readonly Record<string, unknown>[];
  };
  assert.ok(!('startMs' in partial.tokens[0]!));
  assert.ok(!('endMs' in partial.tokens[0]!));
  assert.ok(!('confidence' in partial.tokens[0]!));
});

test('exported validators preserve payloads and map corpus and observation failures safely', async () => {
  const protocol = await import('../src/index.ts');
  const corpus = await readJson(resolve(fixtureDirectory, 'valid/minimal-corpus.json'));
  const observation = await readJson(resolve(fixtureDirectory, 'valid/partial-observation.json'));
  const corpusBefore = JSON.stringify(corpus);
  const observationBefore = JSON.stringify(observation);

  assert.equal(protocol.corpusValidator(corpus), true);
  assert.equal(protocol.observationValidator(observation), true);
  protocol.assertValidCorpus(corpus);
  protocol.assertValidObservation(observation);
  assert.equal(JSON.stringify(corpus), corpusBefore);
  assert.equal(JSON.stringify(observation), observationBefore);

  const unusedSymbol = await readJson(resolve(fixtureDirectory, 'valid/corpus-unused-symbol.json'));
  protocol.assertValidCorpus(unusedSymbol);
  const invalidGraph = await readJson(resolve(fixtureDirectory, 'invalid/corpus-graph-integrity.json'));
  assert.throws(() => protocol.assertValidCorpus(invalidGraph), (error: unknown) => {
    assert.ok(error instanceof protocol.QaraaProtocolError);
    assert.equal(error.code, 'INVALID_CORPUS');
    assert.equal(error.details.kind, 'domain-validation');
    return true;
  });

  for (const [assertion, code] of [
    [protocol.assertValidCorpus, 'INVALID_CORPUS'],
    [protocol.assertValidObservation, 'INVALID_OBSERVATION'],
  ] as const) {
    const payload = { unexpected: true };
    assert.throws(() => assertion(payload), (error: unknown) => {
      assert.ok(error instanceof protocol.QaraaProtocolError);
      assert.equal(error.code, code);
      assert.equal(error.retryable, false);
      assert.equal(error.details.kind, 'schema-validation');
      assert.deepEqual(payload, { unexpected: true });
      return true;
    });
  }
});

test('keeps protocol v1 schemas shape-compatible while typed observation validation enforces work limits', async () => {
  const protocol = await import('../src/index.ts');
  const oversized = {
    observationId: 'oversized-domain-observation',
    sourceRevision: 1,
    isFinal: true,
    receivedAtMs: 1,
    tokens: [{
      id: 'oversized-domain-token',
      text: 'oversized',
      phonemes: Array.from({ length: 129 }, () => 'p'),
    }],
  };
  const boundary = {
    ...oversized,
    observationId: 'boundary-domain-observation',
    tokens: [{
      id: 'boundary-domain-token',
      text: 'boundary',
      phonemes: Array.from({ length: 128 }, () => 'p'),
    }],
  };
  const oversizedCommand = {
    protocolVersion: 1,
    requestId: 'oversized-command',
    type: 'observation.submit',
    sessionId: 'session-domain-limit',
    ...oversized,
  };

  assert.equal(protocol.observationValidator(oversized), true);
  assert.equal(protocol.commandValidator(oversizedCommand), true);
  assert.doesNotThrow(() => protocol.assertValidObservation(boundary));
  assert.throws(() => protocol.assertValidObservation(oversized), (error: unknown) => {
    assert.ok(error instanceof protocol.QaraaProtocolError);
    assert.equal(error.code, 'INVALID_OBSERVATION');
    assert.equal(error.retryable, false);
    assert.equal(error.details.kind, 'domain-validation');
    return true;
  });
  assert.throws(() => protocol.assertValidCommand(oversizedCommand), (error: unknown) => {
    assert.ok(error instanceof protocol.QaraaProtocolError);
    assert.equal(error.code, 'INVALID_OBSERVATION');
    assert.equal(error.details.kind, 'domain-validation');
    return true;
  });
});

test('protocol error envelopes preserve the typed safe JSON contract', async () => {
  const protocol = await import('../src/index.ts');
  const details = { sessionId: 'session-missing', retryAfterMs: null };
  const error = new protocol.QaraaProtocolError(
    'SESSION_NOT_FOUND',
    'Session was not found',
    false,
    details,
  );

  assert.equal(protocol.PROTOCOL_VERSION, 1);
  assert.equal(error.name, 'QaraaProtocolError');
  assert.equal(error.code, 'SESSION_NOT_FOUND');
  assert.equal(error.message, 'Session was not found');
  assert.equal(error.retryable, false);
  assert.deepEqual(error.details, details);
  assert.deepEqual(error.toEnvelope('request-error'), {
    protocolVersion: 1,
    requestId: 'request-error',
    type: 'error',
    code: 'SESSION_NOT_FOUND',
    message: 'Session was not found',
    retryable: false,
    details,
  });
});

test('error details reject non-JSON nested values without mutating the envelope', async () => {
  const { errorValidator, QaraaProtocolError } = await import('../src/index.ts');

  class DetailClass {
    readonly value = 'class-instance';
  }

  for (const invalidValue of [
    undefined,
    () => undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(0),
    new Map([['key', 'value']]),
    new DetailClass(),
  ]) {
    const envelope = {
      protocolVersion: 1,
      requestId: 'request-non-json',
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
      retryable: false,
      details: { nested: { invalidValue } },
    };
    const before = { invalidValue: envelope.details.nested.invalidValue };
    assert.equal(errorValidator(envelope), false);
    assert.equal(envelope.details.nested.invalidValue, before.invalidValue);
    assert.throws(
      () => new QaraaProtocolError('INTERNAL_ERROR', 'Safe message', false, envelope.details as never),
      TypeError,
    );
  }

  const cyclicDetails: Record<string, unknown> = {};
  cyclicDetails.self = cyclicDetails;
  const cyclicEnvelope = {
    protocolVersion: 1,
    requestId: 'request-cycle',
    type: 'error',
    code: 'INTERNAL_ERROR',
    message: 'An internal error occurred',
    retryable: false,
    details: cyclicDetails,
  };
  let cyclicValidation: boolean | undefined;
  assert.doesNotThrow(() => {
    cyclicValidation = errorValidator(cyclicEnvelope);
  });
  assert.equal(cyclicValidation, false);
  assert.throws(
    () => new QaraaProtocolError('INTERNAL_ERROR', 'Safe message', false, cyclicDetails as never),
    (error: unknown) => error instanceof TypeError && !(error instanceof RangeError),
  );

  const mutableDetails: Record<string, unknown> = { safe: true };
  const protocolError = new QaraaProtocolError(
    'INTERNAL_ERROR',
    'Safe message',
    false,
    mutableDetails as never,
  );
  mutableDetails.invalid = new Date(0);
  assert.throws(() => protocolError.toEnvelope('request-mutated'), TypeError);

  const nullPrototypeDetails = Object.create(null) as Record<string, unknown>;
  nullPrototypeDetails.nested = ['plain', { finite: 1 }];
  const nullPrototypeError = new QaraaProtocolError(
    'INTERNAL_ERROR',
    'Safe message',
    false,
    nullPrototypeDetails as never,
  );
  assert.equal(errorValidator(nullPrototypeError.toEnvelope('request-null-prototype')), true);
});

test('schema sync verifier detects semantic drift, not merely valid JSON', async (t) => {
  const { verifySchemaSync } = await import('../../../scripts/verify-schema-sync.mjs');
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'qaraa-schema-sync-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  await cp(schemaDirectory, resolve(temporaryRoot, 'schemas/v1'), { recursive: true });
  await cp(resolve(packageDirectory, 'src/schemas/v1'), resolve(temporaryRoot, 'package-schemas/v1'), {
    recursive: true,
  });
  await cp(fixtureDirectory, resolve(temporaryRoot, 'conformance/v1'), { recursive: true });

  await assert.doesNotReject(verifySchemaSync({
    canonicalSchemaDirectory: resolve(temporaryRoot, 'schemas/v1'),
    packageSchemaDirectory: resolve(temporaryRoot, 'package-schemas/v1'),
    fixtureDirectory: resolve(temporaryRoot, 'conformance/v1'),
  }));

  const driftedPath = resolve(temporaryRoot, 'package-schemas/v1/observation.schema.json');
  const drifted = await readJson(driftedPath) as Record<string, unknown>;
  drifted.title = 'Drifted observation';
  await writeFile(driftedPath, `${JSON.stringify(drifted, null, 2)}\n`);

  await assert.rejects(
    verifySchemaSync({
      canonicalSchemaDirectory: resolve(temporaryRoot, 'schemas/v1'),
      packageSchemaDirectory: resolve(temporaryRoot, 'package-schemas/v1'),
      fixtureDirectory: resolve(temporaryRoot, 'conformance/v1'),
    }),
    /schema drift/i,
  );
});

test('schema sync verifier rejects error-code annotations that disagree with valid payloads', async (t) => {
  const { verifySchemaSync } = await import('../../../scripts/verify-schema-sync.mjs');
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'qaraa-schema-code-sync-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  await cp(schemaDirectory, resolve(temporaryRoot, 'schemas/v1'), { recursive: true });
  await cp(resolve(packageDirectory, 'src/schemas/v1'), resolve(temporaryRoot, 'package-schemas/v1'), {
    recursive: true,
  });
  await cp(fixtureDirectory, resolve(temporaryRoot, 'conformance/v1'), { recursive: true });

  const manifestPath = resolve(temporaryRoot, 'conformance/v1/manifest.json');
  const manifest = await readJson(manifestPath) as ManifestRow[];
  const errorRowIndex = manifest.findIndex((row) => row.file === 'valid/error-envelope.json');
  assert.notEqual(errorRowIndex, -1);
  manifest[errorRowIndex] = { ...manifest[errorRowIndex]!, errorCode: 'INTERNAL_ERROR' };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(
    verifySchemaSync({
      canonicalSchemaDirectory: resolve(temporaryRoot, 'schemas/v1'),
      packageSchemaDirectory: resolve(temporaryRoot, 'package-schemas/v1'),
      fixtureDirectory: resolve(temporaryRoot, 'conformance/v1'),
    }),
    /error code annotation.*does not match payload/i,
  );
});

test('schema sync verifier rejects TypeScript-only message declaration drift', async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'qaraa-type-sync-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const copiedProtocolDirectory = resolve(temporaryRoot, 'protocol');
  await cp(resolve(packageDirectory, 'src'), resolve(copiedProtocolDirectory, 'src'), { recursive: true });
  await cp(
    resolve(packageDirectory, 'type-contract'),
    resolve(copiedProtocolDirectory, 'type-contract'),
    { recursive: true },
  );

  const messagesPath = resolve(copiedProtocolDirectory, 'src/messages.ts');
  const sourceFile = ts.createSourceFile(
    messagesPath,
    await readFile(messagesPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const transformed = ts.transform(sourceFile, [(context) => (root) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isPropertySignature(node)
        && ts.isIdentifier(node.name)
        && node.name.text === 'lastSnapshotRevision') {
        return ts.factory.updatePropertySignature(
          node,
          node.modifiers,
          node.name,
          node.questionToken,
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  await writeFile(
    messagesPath,
    ts.createPrinter().printFile(transformed.transformed[0] as ts.SourceFile),
  );
  transformed.dispose();

  const typeSyncProject = resolve(copiedProtocolDirectory, 'tsconfig.type-sync.json');
  await writeFile(typeSyncProject, `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      moduleResolution: 'Bundler',
      module: 'ESNext',
      target: 'ES2022',
      lib: ['ES2022'],
      types: [],
      noEmit: true,
      allowImportingTsExtensions: true,
      paths: {
        '@atqan/qaraa-core': [relative(
          copiedProtocolDirectory,
          resolve(rootDirectory, 'packages/core/src/index.ts'),
        )],
      },
    },
    include: [
      resolve(copiedProtocolDirectory, 'src/errors.ts'),
      resolve(copiedProtocolDirectory, 'src/messages.ts'),
      resolve(copiedProtocolDirectory, 'src/version.ts'),
      resolve(copiedProtocolDirectory, 'type-contract/**/*.ts'),
    ],
  }, null, 2)}\n`);

  const verifierUrl = pathToFileURL(resolve(rootDirectory, 'scripts/verify-schema-sync.mjs')).href;
  await assert.rejects(execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    `const { verifySchemaSync } = await import(${JSON.stringify(verifierUrl)});
await verifySchemaSync({ typeSyncProject: process.argv[1] });`,
    typeSyncProject,
  ], { cwd: rootDirectory }), (error: unknown) => {
    const processError = error as { code?: number; stderr?: string };
    assert.equal(processError.code, 1);
    assert.match(processError.stderr ?? '', /type contract drift[\s\S]*protocol-v1\.type-test/i);
    return true;
  });
});

test('schema sync verifier rejects TypeScript-only JSON declaration drift', async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'qaraa-json-type-sync-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const copiedProtocolDirectory = resolve(temporaryRoot, 'protocol');
  await cp(resolve(packageDirectory, 'src'), resolve(copiedProtocolDirectory, 'src'), { recursive: true });
  await cp(
    resolve(packageDirectory, 'type-contract'),
    resolve(copiedProtocolDirectory, 'type-contract'),
    { recursive: true },
  );

  const errorsPath = resolve(copiedProtocolDirectory, 'src/errors.ts');
  const sourceFile = ts.createSourceFile(
    errorsPath,
    await readFile(errorsPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const transformed = ts.transform(sourceFile, [(context) => (root) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === 'JsonObject') {
        const indexSignature = ts.factory.createIndexSignature(
          undefined,
          [ts.factory.createParameterDeclaration(
            undefined,
            undefined,
            'key',
            undefined,
            ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
          )],
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
        );
        return ts.factory.updateTypeAliasDeclaration(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          ts.factory.createTypeReferenceNode('Readonly', [
            ts.factory.createTypeLiteralNode([indexSignature]),
          ]),
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  await writeFile(
    errorsPath,
    ts.createPrinter().printFile(transformed.transformed[0] as ts.SourceFile),
  );
  transformed.dispose();

  const typeSyncProject = resolve(copiedProtocolDirectory, 'tsconfig.type-sync.json');
  await writeFile(typeSyncProject, `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      moduleResolution: 'Bundler',
      module: 'ESNext',
      target: 'ES2022',
      lib: ['ES2022'],
      types: [],
      noEmit: true,
      allowImportingTsExtensions: true,
      paths: {
        '@atqan/qaraa-core': [relative(
          copiedProtocolDirectory,
          resolve(rootDirectory, 'packages/core/src/index.ts'),
        )],
      },
    },
    include: [
      resolve(copiedProtocolDirectory, 'src/errors.ts'),
      resolve(copiedProtocolDirectory, 'src/messages.ts'),
      resolve(copiedProtocolDirectory, 'src/version.ts'),
      resolve(copiedProtocolDirectory, 'type-contract/**/*.ts'),
    ],
  }, null, 2)}\n`);

  const verifierUrl = pathToFileURL(resolve(rootDirectory, 'scripts/verify-schema-sync.mjs')).href;
  await assert.rejects(execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    `const { verifySchemaSync } = await import(${JSON.stringify(verifierUrl)});
await verifySchemaSync({ typeSyncProject: process.argv[1] });`,
    typeSyncProject,
  ], { cwd: rootDirectory }), (error: unknown) => {
    const processError = error as { code?: number; stderr?: string };
    assert.equal(processError.code, 1);
    assert.match(processError.stderr ?? '', /type contract drift[\s\S]*protocol-v1\.type-test/i);
    return true;
  });
});

test('schema sync verifier rejects copied core corpus declaration drift', async (t) => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'qaraa-core-type-sync-'));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const copiedProtocolDirectory = resolve(temporaryRoot, 'protocol');
  const copiedCoreDirectory = resolve(temporaryRoot, 'core');
  await cp(resolve(packageDirectory, 'src'), resolve(copiedProtocolDirectory, 'src'), { recursive: true });
  await cp(
    resolve(packageDirectory, 'type-contract'),
    resolve(copiedProtocolDirectory, 'type-contract'),
    { recursive: true },
  );
  await cp(resolve(rootDirectory, 'packages/core/src'), resolve(copiedCoreDirectory, 'src'), {
    recursive: true,
  });

  const corpusTypesPath = resolve(copiedCoreDirectory, 'src/corpus/types.ts');
  const sourceFile = ts.createSourceFile(
    corpusTypesPath,
    await readFile(corpusTypesPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let mutatedRevision = false;
  const transformed = ts.transform(sourceFile, [(context) => (root) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === 'QuranCorpus') {
        const visitCorpusMember = (member: ts.Node): ts.Node => {
          if (ts.isPropertySignature(member)
            && ts.isIdentifier(member.name)
            && member.name.text === 'revision') {
            mutatedRevision = true;
            return ts.factory.updatePropertySignature(
              member,
              member.modifiers,
              member.name,
              member.questionToken,
              ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            );
          }
          return ts.visitEachChild(member, visitCorpusMember, context);
        };
        const corpusType = ts.visitNode(node.type, visitCorpusMember) as ts.TypeNode;
        return ts.factory.updateTypeAliasDeclaration(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          corpusType,
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  assert.equal(mutatedRevision, true, 'QuranCorpus.revision was not found for AST mutation');
  await writeFile(
    corpusTypesPath,
    ts.createPrinter().printFile(transformed.transformed[0] as ts.SourceFile),
  );
  transformed.dispose();

  const typeSyncProject = resolve(copiedProtocolDirectory, 'tsconfig.type-sync.json');
  await writeFile(typeSyncProject, `${JSON.stringify({
    compilerOptions: {
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      moduleResolution: 'Bundler',
      module: 'ESNext',
      target: 'ES2022',
      lib: ['ES2022'],
      types: [],
      noEmit: true,
      allowImportingTsExtensions: true,
      paths: {
        '@atqan/qaraa-core': [relative(
          copiedProtocolDirectory,
          resolve(copiedCoreDirectory, 'src/index.ts'),
        )],
      },
    },
    include: [
      resolve(copiedProtocolDirectory, 'src/errors.ts'),
      resolve(copiedProtocolDirectory, 'src/messages.ts'),
      resolve(copiedProtocolDirectory, 'src/version.ts'),
      resolve(copiedProtocolDirectory, 'type-contract/**/*.ts'),
    ],
  }, null, 2)}\n`);

  const verifierUrl = pathToFileURL(resolve(rootDirectory, 'scripts/verify-schema-sync.mjs')).href;
  await assert.rejects(execFileAsync(process.execPath, [
    '--input-type=module',
    '--eval',
    `const { verifySchemaSync } = await import(${JSON.stringify(verifierUrl)});
await verifySchemaSync({ typeSyncProject: process.argv[1] });`,
    typeSyncProject,
  ], { cwd: rootDirectory }), (error: unknown) => {
    const processError = error as { code?: number; stderr?: string };
    assert.equal(processError.code, 1);
    assert.match(processError.stderr ?? '', /type contract drift[\s\S]*protocol-v1\.type-test/i);
    return true;
  });
});

test('type-sync project resolves schema-relevant core declarations from source', () => {
  const projectPath = resolve(packageDirectory, 'tsconfig.type-sync.json');
  const config = ts.readConfigFile(projectPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(projectPath));
  assert.deepEqual(parsed.errors, []);

  const resolution = ts.resolveModuleName(
    '@atqan/qaraa-core',
    resolve(packageDirectory, 'type-contract/protocol-v1.type-test.ts'),
    parsed.options,
    ts.sys,
  ).resolvedModule;
  assert.ok(resolution);
  assert.equal(
    resolve(resolution.resolvedFileName),
    resolve(rootDirectory, 'packages/core/src/index.ts'),
  );
});
