/** @license Apache-2.0 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(new URL('../.github/workflows/ci-sdks.yml', import.meta.url), 'utf8');

test('native CI follows protocol and server source changes', () => {
  for (const path of [
    "'packages/protocol/**'",
    "'packages/server/**'",
    "'package.json'",
    "'pnpm-lock.yaml'",
    "'pnpm-workspace.yaml'",
  ]) {
    assert.match(workflow, new RegExp(path.replaceAll('*', '\\*')));
  }
});

test('native CI runs Go and Dart against actual lifecycle and stream endpoints', () => {
  assert.match(workflow, /go run \.\/cmd\/server-smoke \.\.\/\.\./);
  assert.match(workflow, /dart run tool\/server_smoke\.dart \.\.\/\.\./);
  assert.doesNotMatch(workflow, /dart run tool\/(?:server_smoke|conformance)\.dart --/);
  assert.match(workflow, /node --test [^\n]*scripts\/ci-native-smoke\.test\.mjs/);
});

test('native CI enforces canonical Dart and Flutter formatting', () => {
  assert.match(workflow, /dart format --output=none --set-exit-if-changed lib test tool/);
  assert.match(workflow, /dart format --output=none --set-exit-if-changed lib test/);
});

test('native package audit removes generated Python archives before source inspection', () => {
  assert.match(workflow, /rm -rf sdk\/python\/dist/);
  assert.match(workflow, /node scripts\/audit-native-packages\.mjs --source-only/);
});
