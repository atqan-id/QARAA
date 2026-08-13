import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { findBoundaryViolations } from './audit-boundaries.mjs';
import { inspectPackList, validateManifest } from './audit-package.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('reports framework and browser globals in core source', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'qaraa-boundary-'));
  const sourcePath = join(directory, 'core.ts');
  const source = "import { useState } from 'react';\nwindow.alert('x');\nnavigator.language;\n";

  await writeFile(sourcePath, source);
  t.after(() => rm(directory, { force: true, recursive: true }));

  const sourceText = await readFile(sourcePath, 'utf8');
  const violations = findBoundaryViolations(sourceText, sourcePath);

  assert.deepEqual(
    violations.map(({ rule }) => rule),
    ['framework import', 'browser API', 'browser API'],
  );
  assert.deepEqual(
    violations.map(({ symbol }) => symbol).sort(),
    ['navigator', 'react', 'window'],
  );
});

test('rejects bare Node built-in subpath imports', () => {
  const violations = findBoundaryViolations("import { readFile } from 'fs/promises';\n", '/tmp/core.ts');

  assert.deepEqual(
    violations.map(({ symbol }) => symbol),
    ['fs/promises'],
  );
  assert.deepEqual(
    violations.map(({ rule }) => rule),
    ['Node built-in import'],
  );
});

test('does not treat local browser-like identifiers, comments, or strings as browser APIs', () => {
  const source = `
    const window = { label: 'local' };
    // navigator and document are mentioned in a comment.
    const message = 'fetch from localStorage';
    window.label;
  `;

  const violations = findBoundaryViolations(source, '/tmp/core.ts');

  assert.deepEqual(violations, []);
});

test('rejects browser globals and global-object browser members outside the original identifier set', () => {
  const source = `
    globalThis.window.alert('x');
    new Audio();
    new HTMLElement();
  `;

  const violations = findBoundaryViolations(source, '/tmp/core.ts');

  assert.deepEqual(
    violations.map(({ symbol }) => symbol).sort(),
    ['Audio', 'HTMLElement', 'window'],
  );
});

test('ignores commented imports and locally bound require calls', () => {
  const source = `
    // import 'react';
    const require = (specifier) => specifier;
    require('fs');
  `;

  const violations = findBoundaryViolations(source, '/tmp/core.ts');

  assert.deepEqual(violations, []);
});

test('rejects static no-substitution template module specifiers', () => {
  const source = `
    import(\`react\`);
    require(\`fs\`);
  `;

  const violations = findBoundaryViolations(source, '/tmp/core.ts');

  assert.deepEqual(
    violations.map(({ symbol }) => symbol).sort(),
    ['fs', 'react'],
  );
});

test('rejects computed and destructured browser globals from globalThis', () => {
  const source = `
    globalThis['window'].alert('x');
    const { window } = globalThis;
    window.alert('x');
  `;

  const violations = findBoundaryViolations(source, '/tmp/core.ts');

  assert.deepEqual(
    violations.map(({ symbol }) => symbol),
    ['window', 'window'],
  );
});

test('ignores computed and destructured browser-like properties on a shadowed globalThis', () => {
  const source = `
    const globalThis = { window: { alert: () => undefined } };
    globalThis['window'].alert('x');
    const { window } = globalThis;
    window.alert('x');
  `;

  const violations = findBoundaryViolations(source, '/tmp/core.ts');

  assert.deepEqual(violations, []);
});

test('respects function-scoped var bindings named globalThis', () => {
  const source = `
    function inspect() {
      if (true) {
        var globalThis = { window: { alert: () => undefined } };
      }
      globalThis['window'].alert('x');
    }
  `;

  const violations = findBoundaryViolations(source, '/tmp/core.ts');

  assert.deepEqual(violations, []);
});

test('rejects secrets, models, applications, and undeclared package files', () => {
  const violations = inspectPackList('/tmp/qaraa-core', [
    'dist/index.js',
    'README.md',
    'LICENSE',
    'package.json',
    '.env.production',
    'token.txt',
    'dist/model.onnx',
    'dist/weights.gguf',
    'dist/models/acoustic.model',
    'dist/datasets/quran.json',
    'dist/corpus.csv',
    'dist/verses.json',
    'dist/app/config.json',
    'dist/application.js',
    'dist/assets/private-config.json',
    'src/app.ts',
    'notes.txt',
  ]);

  assert.deepEqual(
    violations.map(({ fileName }) => fileName),
    [
      '.env.production',
      'token.txt',
      'dist/model.onnx',
      'dist/weights.gguf',
      'dist/models/acoustic.model',
      'dist/datasets/quran.json',
      'dist/corpus.csv',
      'dist/verses.json',
      'dist/app/config.json',
      'dist/application.js',
      'dist/assets/private-config.json',
      'src/app.ts',
      'notes.txt',
    ],
  );
});

test('allows versioned protocol schemas without treating the corpus schema as a dataset', () => {
  assert.deepEqual(
    inspectPackList('/tmp/qaraa-protocol', ['dist/schemas/v1/corpus.schema.json']),
    [],
  );
});

test('rejects absolute source-map paths and repository path disclosure', async () => {
  const audit = await import('./audit-package.mjs');
  assert.equal(typeof audit.inspectSourceMap, 'function');
  const violations = audit.inspectSourceMap(
    'dist/index.mjs.map',
    JSON.stringify({
      version: 3,
      sourceRoot: 'file:///private/tmp/qaraa',
      sources: ['/Users/example/private.ts', 'C:\\private\\source.ts'],
      sourcesContent: ['export const safe = true;'],
      names: [],
      mappings: '',
    }),
    '/private/tmp/qaraa',
  );

  assert.deepEqual(
    violations.map(({ reason }) => reason),
    [
      'absolute source-map sourceRoot',
      'absolute source-map source',
      'absolute source-map source',
      'repository path disclosure',
    ],
  );
});

test('rejects POSIX, Windows-drive, and UNC source-map file paths', async () => {
  const audit = await import('./audit-package.mjs');
  const absoluteFiles = [
    '/private/tmp/qaraa/index.cjs',
    'C:\\private\\qaraa\\index.cjs',
    '\\\\build-server\\qaraa\\index.cjs',
  ];

  for (const absoluteFile of absoluteFiles) {
    assert.deepEqual(
      audit.inspectSourceMap(
        'dist/index.cjs.map',
        JSON.stringify({
          version: 3,
          file: absoluteFile,
          sources: ['../src/index.ts'],
          names: [],
          mappings: '',
        }),
      ).map(({ reason }) => reason),
      ['absolute source-map file'],
      absoluteFile,
    );
  }
});

test('rejects secret material in packed text without flagging ordinary source', async () => {
  const audit = await import('./audit-package.mjs');
  assert.equal(typeof audit.inspectPackedContent, 'function');
  const privateKey = ['-----BEGIN', 'PRIVATE KEY-----'].join(' ');
  assert.deepEqual(
    audit.inspectPackedContent('dist/index.mjs', `const credential = ${JSON.stringify(privateKey)};`)
      .map(({ reason }) => reason),
    ['secret material'],
  );
  assert.deepEqual(
    audit.inspectPackedContent('dist/index.mjs', 'export const tokenConfidence = 0.8;'),
    [],
  );
});

test('rejects common service credentials and private endpoints in packed text', async () => {
  const audit = await import('./audit-package.mjs');
  const googleCredential = `AIza${'A'.repeat(35)}`;
  const slackCredential = `xoxb-${'1'.repeat(12)}-${'A'.repeat(24)}`;
  const packedSource = [
    googleCredential,
    slackCredential,
    'https://recitation-api.service.internal/v1',
    'https://192.168.50.12/session',
  ].join('\n');

  assert.deepEqual(
    audit.inspectPackedContent('dist/index.mjs', packedSource).map(({ reason }) => reason),
    ['secret material', 'secret material', 'private endpoint', 'private endpoint'],
  );
});

test('rejects encoded model weights embedded in an allowed bundle', async () => {
  const audit = await import('./audit-package.mjs');
  const encodedGguf = `R0dVRg${'A'.repeat(96)}`;
  const numericWeights = Array.from({ length: 16 }, (_, index) => index).join(', ');

  assert.deepEqual(
    audit.inspectPackedContent(
      'dist/index.cjs',
      `const acousticModelWeightsBase64 = ${JSON.stringify(encodedGguf)};`,
    ).map(({ reason }) => reason),
    ['model material'],
  );
  assert.deepEqual(
    audit.inspectPackedContent(
      'dist/index.cjs',
      `const model = ${JSON.stringify(encodedGguf)};`,
    ).map(({ reason }) => reason),
    ['model material'],
  );
  assert.deepEqual(
    audit.inspectPackedContent(
      'dist/index.cjs',
      `const weights = new Uint8Array([${numericWeights}, 0]);`,
    ).map(({ reason }) => reason),
    ['model material'],
  );
});

test('rejects model magic and model data URIs under opaque bundle identifiers', async () => {
  const audit = await import('./audit-package.mjs');
  const encodedGguf = `R0dVRg${'A'.repeat(96)}`;
  const onnxDataUri = `data:application/onnx;base64,${'A'.repeat(96)}`;

  for (const packedSource of [
    `const a = ${JSON.stringify(encodedGguf)};`,
    `const b = ${JSON.stringify(onnxDataUri)};`,
  ]) {
    assert.deepEqual(
      audit.inspectPackedContent('dist/index.cjs', packedSource).map(({ reason }) => reason),
      ['model material'],
      packedSource,
    );
  }
});

test('rejects anonymous typed model magic without flagging ordinary library arrays', async () => {
  const audit = await import('./audit-package.mjs');
  const ggufBytes = [71, 71, 85, 70, 3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const ordinaryBytes = Array.from({ length: 17 }, (_, index) => index);
  const ordinaryCoefficients = [0.4, 0.25, 0.2, 0.15];

  assert.deepEqual(
    audit.inspectPackedContent(
      'dist/index.cjs',
      `const a = new Uint8Array([${ggufBytes.join(', ')}]);`,
    ).map(({ reason }) => reason),
    ['model material'],
  );
  assert.deepEqual(
    audit.inspectPackedContent(
      'dist/index.cjs',
      `const a = new Uint8Array([${ordinaryBytes.join(', ')}]);`,
    ),
    [],
  );
  assert.deepEqual(
    audit.inspectPackedContent(
      'dist/index.cjs',
      `const scoreWeights = new Float32Array([${ordinaryCoefficients.join(', ')}]);`,
    ),
    [],
  );
});

test('detects opaque model payloads inside source-map sourcesContent', async () => {
  const audit = await import('./audit-package.mjs');
  const encodedGguf = `R0dVRg${'A'.repeat(96)}`;
  const ggufBytes = [71, 71, 85, 70, 3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const sourceMap = JSON.stringify({
    version: 3,
    file: 'index.cjs',
    sources: ['../src/a.ts', '../src/b.ts'],
    sourcesContent: [
      `const a = ${JSON.stringify(encodedGguf)};`,
      `const b = new Uint8Array([${ggufBytes.join(', ')}]);`,
    ],
    names: [],
    mappings: '',
  });

  assert.deepEqual(
    audit.inspectPackedContent('dist/index.cjs.map', sourceMap).map(({ reason }) => reason),
    ['model material'],
  );
});

test('detects realistic opaque TFLite base64 headers in bundles and sourcesContent', async () => {
  const audit = await import('./audit-package.mjs');
  const tfliteBytes = [28, 0, 0, 0, 84, 70, 76, 51, ...Array(64).fill(0)];
  const encodedTflite = Buffer.from(tfliteBytes).toString('base64');
  const opaqueSource = `const a = ${JSON.stringify(encodedTflite)};`;
  const sourceMap = JSON.stringify({
    version: 3,
    file: 'index.cjs',
    sources: ['../src/a.ts'],
    sourcesContent: [opaqueSource],
    names: [],
    mappings: '',
  });

  assert.deepEqual(
    audit.inspectPackedContent('dist/index.cjs', opaqueSource).map(({ reason }) => reason),
    ['model material'],
  );
  assert.deepEqual(
    audit.inspectPackedContent('dist/index.cjs.map', sourceMap).map(({ reason }) => reason),
    ['model material'],
  );
});

test('rejects embedded Quran dataset records without flagging library code or protocol schemas', async () => {
  const audit = await import('./audit-package.mjs');
  const quranDataset = `
    const quranDataset = [
      { surah: 1, ayah: 1, text: 'ٱلْحَمْدُ لِلَّهِ' },
    ];
  `;
  const ordinaryLibrary = `
    export function validateCorpus(corpus) {
      return corpus.symbols.every((symbol) => symbol.location.ayah > 0);
    }
    export class ApplicationStateModel {}
    export const modelIdentifier = '${'A'.repeat(96)}';
  `;
  const protocolSchema = JSON.stringify({
    title: 'QARAA Quran Corpus v1',
    examples: [{ surah: 1, ayah: 1, text: 'ٱلْحَمْدُ لِلَّهِ' }],
  });
  const compromisedProtocolSchema = JSON.stringify({
    title: 'QARAA Quran Corpus v1',
    modelWeightsBase64: `R0dVRg${'A'.repeat(96)}`,
  });

  assert.deepEqual(
    audit.inspectPackedContent('dist/index.cjs', quranDataset).map(({ reason }) => reason),
    ['dataset material'],
  );
  assert.deepEqual(audit.inspectPackedContent('dist/index.cjs', ordinaryLibrary), []);
  assert.deepEqual(
    audit.inspectPackedContent('dist/schemas/v1/corpus.schema.json', protocolSchema),
    [],
  );
  assert.deepEqual(
    audit.inspectPackedContent(
      'dist/schemas/v1/corpus.schema.json',
      compromisedProtocolSchema,
    ).map(({ reason }) => reason),
    ['model material'],
  );
  assert.deepEqual(
    audit.inspectPackedContent('dist/index.cjs.map', JSON.stringify({
      version: 3,
      file: 'index.cjs',
      sources: ['../src/corpus/validate.ts', '../src/client/session.ts', '../src/server/http.ts'],
      sourcesContent: [ordinaryLibrary, ordinaryLibrary, ordinaryLibrary],
      names: [],
      mappings: '',
    })),
    [],
  );
});

test('rejects application payloads and forbidden source-map provenance in allowed files', async () => {
  const audit = await import('./audit-package.mjs');
  const applicationBundle = `
    const applicationShell = '<!doctype html><html><body><div id="app"></div></body></html>';
  `;
  const sourceMap = JSON.stringify({
    version: 3,
    file: 'index.cjs',
    sources: [
      '../embedded/acoustic-model.onnx',
      '../data/quran.json',
      '../pages/application.tsx',
      '../src/index.ts',
      '../src/schemas/v1/corpus.schema.json',
    ],
    sourcesContent: ['', '', '', 'export const safe = true;', '{}'],
    names: [],
    mappings: '',
  });

  assert.deepEqual(
    audit.inspectPackedContent('dist/index.cjs', applicationBundle).map(({ reason }) => reason),
    ['application material'],
  );
  assert.deepEqual(
    audit.inspectPackedContent('dist/index.cjs.map', sourceMap).map(({ reason }) => reason),
    ['model material', 'dataset material', 'application material'],
  );
  for (const applicationSource of ['../application/main.ts', '../assets/web-shell.js']) {
    assert.deepEqual(
      audit.inspectPackedContent('dist/index.cjs.map', JSON.stringify({
        version: 3,
        file: 'index.cjs',
        sources: [applicationSource],
        sourcesContent: ['export const shell = true;'],
        names: [],
        mappings: '',
      })).map(({ reason }) => reason),
      ['application material'],
      applicationSource,
    );
  }
});

test('rejects runtime imports not declared by their package', async () => {
  const audit = await import('./audit-package.mjs');
  assert.equal(typeof audit.inspectRuntimeImports, 'function');
  const violations = audit.inspectRuntimeImports(
    '/tmp/qaraa-server',
    {
      name: '@atqan/qaraa-server',
      dependencies: { fastify: '5.11.3' },
    },
    `
      import Fastify from 'fastify';
      import { PROTOCOL_VERSION } from '@atqan/qaraa-protocol';
      import { randomUUID } from 'node:crypto';
      import './local.js';
    `,
    'dist/index.mjs',
  );

  assert.deepEqual(
    violations,
    ['/tmp/qaraa-server: undeclared runtime dependency @atqan/qaraa-protocol in dist/index.mjs'],
  );
});

test('rejects .env-prefixed files inside dist', () => {
  const violations = inspectPackList('/tmp/qaraa-core', ['dist/.envrc']);

  assert.deepEqual(
    violations.map(({ fileName }) => fileName),
    ['dist/.envrc'],
  );
});

test('allows only the explicitly audited protocol runtime dependencies', () => {
  const protocolManifest = {
    name: '@atqan/qaraa-protocol',
    exports: { '.': './dist/index.mjs' },
    sideEffects: false,
    dependencies: {
      '@atqan/qaraa-core': 'workspace:*',
      ajv: '8.20.0',
    },
  };

  assert.deepEqual(validateManifest('/tmp/protocol', protocolManifest), []);
  assert.match(
    validateManifest('/tmp/protocol', {
      ...protocolManifest,
      dependencies: { ...protocolManifest.dependencies, undici: '7.0.0' },
    }).join('\n'),
    /undici.*explicit audit/,
  );
  assert.match(
    validateManifest('/tmp/core', { ...protocolManifest, name: '@atqan/qaraa-core' }).join('\n'),
    /ajv.*explicit audit/,
  );
});

test('allows only the server runtime dependencies at their audited versions', () => {
  const serverManifest = {
    name: '@atqan/qaraa-server',
    exports: { '.': './dist/index.mjs' },
    sideEffects: false,
    dependencies: {
      '@atqan/qaraa-core': 'workspace:*',
      '@atqan/qaraa-protocol': 'workspace:*',
      '@fastify/websocket': '11.3.0',
      fastify: '5.11.3',
    },
  };

  assert.deepEqual(validateManifest('/tmp/server', serverManifest), []);
  assert.match(
    validateManifest('/tmp/server', {
      ...serverManifest,
      dependencies: { ...serverManifest.dependencies, fastify: '^5.11.3' },
    }).join('\n'),
    /fastify.*explicit audit/u,
  );
});

test('allows only the client core and protocol runtime dependencies', () => {
  const clientManifest = {
    name: '@atqan/qaraa-client',
    exports: { '.': './dist/index.mjs' },
    sideEffects: false,
    dependencies: {
      '@atqan/qaraa-core': 'workspace:*',
      '@atqan/qaraa-protocol': 'workspace:*',
    },
  };

  assert.deepEqual(validateManifest('/tmp/client', clientManifest), []);
  assert.match(
    validateManifest('/tmp/client', {
      ...clientManifest,
      dependencies: { ...clientManifest.dependencies, ws: '8.18.3' },
    }).join('\n'),
    /ws.*explicit audit/u,
  );
});

test('allows only the optional normalizer core runtime dependency', () => {
  const normalizerManifest = {
    name: '@atqan/qaraa-sherpa-onnx',
    exports: { '.': './dist/index.mjs' },
    sideEffects: false,
    dependencies: {
      '@atqan/qaraa-core': 'workspace:*',
    },
  };

  assert.deepEqual(validateManifest('/tmp/sherpa-onnx', normalizerManifest), []);
  assert.match(
    validateManifest('/tmp/sherpa-onnx', {
      ...normalizerManifest,
      dependencies: { ...normalizerManifest.dependencies, 'sherpa-onnx-node': '1.0.0' },
    }).join('\n'),
    /sherpa-onnx-node.*explicit audit/u,
  );
});

test('publishes no client test diagnostics in any dist artifact', async () => {
  const clientDirectory = join(repositoryRoot, 'packages/client');
  await execFileAsync('pnpm', ['--filter', '@atqan/qaraa-client', 'build'], {
    cwd: repositoryRoot,
  });
  const { stdout } = await execFileAsync(
    'pnpm',
    ['--dir', clientDirectory, 'pack', '--dry-run', '--json'],
  );
  const result = JSON.parse(stdout);
  const pack = Array.isArray(result) ? result[0] : result;
  assert.ok(pack && Array.isArray(pack.files), 'pnpm pack must return a file list');

  const distFiles = pack.files
    .map((file) => typeof file === 'string' ? file : file.path)
    .map((fileName) => fileName.replace(/^package\//u, ''))
    .filter((fileName) => fileName.startsWith('dist/'));
  assert.ok(distFiles.length > 0, 'client tarball must include built dist artifacts');

  const diagnosticIdentifiers = [
    'RemoteSessionTestState',
    'createRemoteSessionTestState',
    'createRemoteSessionForTest',
  ];
  const leaked = [];
  for (const fileName of distFiles) {
    const content = await readFile(join(clientDirectory, fileName), 'utf8');
    for (const identifier of diagnosticIdentifiers) {
      if (content.includes(identifier)) leaked.push(`${fileName}: ${identifier}`);
    }
  }

  assert.deepEqual(leaked, []);
});

test('runs both audit CLIs when their repository path contains spaces', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'qaraa audit '));
  t.after(() => rm(workspace, { force: true, recursive: true }));

  const scriptsDirectory = join(workspace, 'scripts');
  await mkdir(join(workspace, 'packages/core/src'), { recursive: true });
  await mkdir(scriptsDirectory, { recursive: true });
  await symlink(join(repositoryRoot, 'node_modules'), join(workspace, 'node_modules'));
  await copyFile(resolve(repositoryRoot, 'scripts/audit-boundaries.mjs'), join(scriptsDirectory, 'audit-boundaries.mjs'));
  await copyFile(resolve(repositoryRoot, 'scripts/audit-package.mjs'), join(scriptsDirectory, 'audit-package.mjs'));
  await writeFile(join(workspace, 'packages/core/src/index.ts'), "import 'react';\n");
  await writeFile(join(workspace, 'packages/core/package.json'), JSON.stringify({
    name: '@example/core',
    version: '0.0.0',
  }));

  await assert.rejects(
    execFileAsync(process.execPath, [join(scriptsDirectory, 'audit-boundaries.mjs')]),
    (error) => error.code === 1 && /framework import/.test(error.stderr),
  );
  await assert.rejects(
    execFileAsync(process.execPath, [join(scriptsDirectory, 'audit-package.mjs')]),
    (error) => error.code === 1 && /explicit exports/.test(error.stderr),
  );
});
