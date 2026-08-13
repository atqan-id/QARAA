/** @license Apache-2.0 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { auditNativeTree } from './audit-native-packages.mjs';

test('audit covers SDKs and examples while ignoring generated caches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qaraa-native-audit-'));
  await mkdir(join(root, 'sdk', 'python', '__pycache__'), { recursive: true });
  await mkdir(join(root, 'examples', 'flutter'), { recursive: true });
  await mkdir(join(root, 'examples', 'nextjs', '.next', 'cache'), { recursive: true });
  await writeFile(join(root, 'sdk', 'python', 'client.py'), 'LIMIT = 1024\n');
  await writeFile(join(root, 'sdk', 'python', '__pycache__', 'client.pyc'), 'ignored');
  await writeFile(
    join(root, 'examples', 'nextjs', '.next', 'cache', 'compiler.bin'),
    '/Users/developer/private/generated-output',
  );
  await writeFile(join(root, 'examples', 'flutter', '.env.secret'), 'TOKEN=x\n');

  const result = await auditNativeTree(root, { inspectTools: false });

  assert.equal(result.files, 2);
  assert.deepEqual(result.errors, [
    'examples/flutter/.env.secret: forbidden artifact',
  ]);
});

test('audit rejects native/model artifacts and developer absolute paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qaraa-native-audit-'));
  await mkdir(join(root, 'sdk', 'dart'), { recursive: true });
  await mkdir(join(root, 'examples', 'go-server'), { recursive: true });
  await writeFile(join(root, 'sdk', 'dart', 'model.onnx'), 'binary');
  await writeFile(
    join(root, 'examples', 'go-server', 'README.md'),
    'run from /Users/developer/private/repo\n',
  );

  const result = await auditNativeTree(root, { inspectTools: false });

  assert.deepEqual(result.errors, [
    'examples/go-server/README.md: local absolute path',
    'sdk/dart/model.onnx: forbidden artifact',
  ]);
});

test('audit rejects credentials, model bytes, and corpus payloads by content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qaraa-native-audit-'));
  await mkdir(join(root, 'sdk', 'python'), { recursive: true });
  await writeFile(
    join(root, 'sdk', 'python', 'credentials.txt'),
    'api_key = "live_native_secret_1234567890"\n',
  );
  await writeFile(
    join(root, 'sdk', 'python', 'opaque.dat'),
    Buffer.from([0, 0, 0, 0, 84, 70, 76, 51, 1, 2, 3]),
  );
  await writeFile(join(root, 'sdk', 'python', 'embedded-tflite.txt'), 'data:application/octet-stream;base64,AAAAAFRGTDM=');
  await writeFile(join(root, 'sdk', 'python', 'embedded-gguf.txt'), 'data:application/octet-stream;base64,R0dVRg==');
  await writeFile(join(root, 'sdk', 'python', 'arbitrary.gguf'), 'not-a-magic-header');
  const minimalOnnx = Buffer.from([0x08, 0x09, 0x3a, 0x02, 0x12, 0x00]).toString('base64');
  await writeFile(
    join(root, 'sdk', 'python', 'protobuf-onnx.txt'),
    `data:application/onnx;base64,${minimalOnnx}`,
  );
  await writeFile(join(root, 'sdk', 'python', 'github.txt'), 'github_pat_' + 'A'.repeat(40));
  await writeFile(
    join(root, 'sdk', 'python', 'payload.json'),
    JSON.stringify({ corpusId: 'bundled', revision: '1', symbols: [], words: [] }),
  );
  await writeFile(
    join(root, 'sdk', 'python', 'bundled.py'),
    'payload = {"corpusId": "bundled", "symbols": [], "words": []}\n',
  );

  const result = await auditNativeTree(root, { inspectTools: false });

  assert.deepEqual(result.errors, [
    'sdk/python/arbitrary.gguf: forbidden artifact',
    'sdk/python/bundled.py: embedded corpus data',
    'sdk/python/credentials.txt: possible credential material',
    'sdk/python/embedded-gguf.txt: embedded model content',
    'sdk/python/embedded-tflite.txt: embedded model content',
    'sdk/python/github.txt: possible credential material',
    'sdk/python/opaque.dat: embedded model content',
    'sdk/python/payload.json: embedded corpus data',
    'sdk/python/protobuf-onnx.txt: embedded model content',
  ]);
});

test('audit inspects Python archive contents, not only member names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qaraa-native-audit-'));
  const dist = join(root, 'sdk', 'python', 'dist');
  await mkdir(dist, { recursive: true });
  const wheel = join(dist, 'qaraa-1.0-py3-none-any.whl');
  const script = [
    'import sys, zipfile',
    'with zipfile.ZipFile(sys.argv[1], "w") as z:',
    ' z.writestr("qaraa/innocent.txt", "password=archive_secret_1234567890")',
    ' z.writestr("qaraa/corpus.py", "payload = {\\\"corpusId\\\": \\\"x\\\", \\\"symbols\\\": [], \\\"words\\\": []}")',
    ' z.writestr("qaraa/tflite.txt", "data:application/octet-stream;base64,AAAAAFRGTDM=")',
    ' z.writestr("qaraa/gguf.txt", "data:application/octet-stream;base64,R0dVRg==")',
    ' z.writestr("qaraa/github.txt", "ghp_" + "A" * 36)',
    ' z.writestr("qaraa/arbitrary.gguf", "no magic")',
    ' z.writestr("qaraa/protobuf-onnx.txt", "data:application/onnx;base64,CAk6AhIA")',
  ].join('\n');
  const made = spawnSync('python3', ['-c', script, wheel], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);

  const result = await auditNativeTree(root, { inspectTools: false });

  assert.deepEqual(result.errors, [
    'sdk/python/dist/qaraa-1.0-py3-none-any.whl:qaraa/arbitrary.gguf: forbidden artifact',
    'sdk/python/dist/qaraa-1.0-py3-none-any.whl:qaraa/corpus.py: embedded corpus data',
    'sdk/python/dist/qaraa-1.0-py3-none-any.whl:qaraa/gguf.txt: embedded model content',
    'sdk/python/dist/qaraa-1.0-py3-none-any.whl:qaraa/github.txt: possible credential material',
    'sdk/python/dist/qaraa-1.0-py3-none-any.whl:qaraa/innocent.txt: possible credential material',
    'sdk/python/dist/qaraa-1.0-py3-none-any.whl:qaraa/protobuf-onnx.txt: embedded model content',
    'sdk/python/dist/qaraa-1.0-py3-none-any.whl:qaraa/tflite.txt: embedded model content',
  ]);
});
