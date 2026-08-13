/** @license Apache-2.0 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = await Promise.all([
  'ci-core.yml',
  'ci-adapters.yml',
  'ci-sdks.yml',
].map((name) => readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8')));

const [coreWorkflow, adapterWorkflow, sdkWorkflow] = files;

function stepPosition(workflow, step) {
  const position = workflow.indexOf(step);
  assert.notEqual(position, -1, `missing CI step: ${step}`);
  return position;
}

test('CI uses a Node version supported by the pinned pnpm release', () => {
  for (const workflow of files) assert.doesNotMatch(workflow, /22\.12/u);
});

test('CI uses Node 24-compatible official actions', () => {
  for (const workflow of files) {
    assert.doesNotMatch(workflow, /actions\/checkout@v4/u);
    assert.doesNotMatch(workflow, /actions\/setup-node@v4/u);
    assert.doesNotMatch(workflow, /actions\/setup-python@v5/u);
    assert.doesNotMatch(workflow, /pnpm\/action-setup@v4/u);
  }
});

test('fresh-checkout CI builds workspace packages before checks and bundle audits', () => {
  assert.ok(
    stepPosition(coreWorkflow, 'run: pnpm build') <
      stepPosition(coreWorkflow, 'run: pnpm run audit'),
    'core CI must build emitted adapter bundles before auditing them',
  );

  assert.ok(
    stepPosition(adapterWorkflow, 'run: pnpm build') <
      stepPosition(adapterWorkflow, 'run: pnpm check'),
    'adapter CI must build workspace dependency declarations before checking consumers',
  );
});

test('core CI serializes workspace unit tests to avoid runner port flakiness', () => {
  assert.match(
    coreWorkflow,
    /name: Unit tests\s*\n\s*run: pnpm --workspace-concurrency=1 -r test/u,
  );
});

test('adapter CI runs its focused suite instead of duplicating the full workspace tests', () => {
  const currentJob = adapterWorkflow.slice(
    adapterWorkflow.indexOf('  current:'),
    adapterWorkflow.indexOf('  minimum-peers:'),
  );
  assert.match(currentJob, /run: pnpm test:adapters/u);
  assert.doesNotMatch(currentJob, /run: pnpm test\s*$/mu);
});

test('minimum-peer CI installs a compatible Angular toolchain and builds QARAA dependencies', () => {
  for (const dependency of [
    'typescript@5.9.3',
    '@angular/common@20.3.27',
    '@angular/platform-browser@20.3.27',
  ]) {
    assert.match(adapterWorkflow, new RegExp(dependency.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }

  assert.match(
    adapterWorkflow,
    /pnpm --filter @atqan\/qaraa-core build[\s\S]*pnpm --filter @atqan\/qaraa-client build/u,
  );

  const minimumPeerJob = adapterWorkflow.slice(adapterWorkflow.indexOf('  minimum-peers:'));
  assert.doesNotMatch(
    minimumPeerJob,
    /packages\/\{react,preact,vue,angular,svelte,solid,lit\}' test/u,
    'minimum-peer runtime tests would mix root and workspace framework instances; compile compatibility is the valid gate',
  );
});

test('native SDK workflow can be run manually', () => {
  assert.match(sdkWorkflow, /workflow_dispatch:/u);
  assert.match(sdkWorkflow, /push:\s*\n\s*branches: \[main\]/u);
  assert.doesNotMatch(sdkWorkflow, /push:\s*\n\s*paths:/u);
  assert.match(sdkWorkflow, /dart run tool\/server_smoke\.dart \.\.\/\.\./u);
  assert.doesNotMatch(sdkWorkflow, /dart run tool\/server_smoke\.dart --/u);
});
