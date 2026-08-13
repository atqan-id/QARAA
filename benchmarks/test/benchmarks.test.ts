import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BENCHMARK_SCENARIOS,
  defaultBenchmarkOptions,
  runBenchmarkSuite,
  writeBenchmarkReport,
} from '../src/run-benchmarks.ts';
import { createSyntheticObservation } from '../src/scenarios.ts';
import { validateBenchmarkReport } from '../src/validate-report.ts';

test('defaults to twenty warmups and one hundred measured iterations', () => {
  assert.deepEqual(defaultBenchmarkOptions(), { warmups: 20, iterations: 100 });
});

test('represents a twenty-phoneme fast chunk as twenty deterministic tokens', () => {
  const observation = createSyntheticObservation(
    'twenty-token-fast-chunk',
    1,
    Array.from({ length: 20 }, (_, index) => `synthetic-${index}`),
  );

  assert.equal(observation.tokens.length, 20);
  assert.deepEqual(observation.tokens[19]!.phonemes, ['synthetic-19']);
});

test('runs all six synthetic scenarios with bounded measured operations', async () => {
  const report = await runBenchmarkSuite({ warmups: 0, iterations: 1 });

  assert.deepEqual(
    report.scenarios.map(({ scenario }) => scenario),
    BENCHMARK_SCENARIOS,
  );
  assert.equal(report.runtime.node, process.versions.node);
  assert.equal(report.runtime.v8, process.versions.v8);
  assert.deepEqual(report.config, { warmups: 0, iterations: 1 });
  assert.equal(validateBenchmarkReport(report).valid, true);
  for (const scenario of report.scenarios) {
    assert.ok(scenario.medianMilliseconds >= 0);
    assert.ok(scenario.p95Milliseconds >= scenario.medianMilliseconds);
    assert.ok(Number.isInteger(scenario.heapDeltaBytes));
    assert.ok(scenario.candidateEvaluations <= 64);
    assert.ok(scenario.editCells >= 0);
    if (scenario.candidateEvaluations > 0) {
      assert.ok(scenario.corpusSymbolsAccessed < scenario.corpusSymbolCount);
    }
  }
});

test('validator rejects operation-count ceiling and full-scan violations without timing thresholds', async () => {
  const report = await runBenchmarkSuite({ warmups: 0, iterations: 1 });
  const invalidCandidateCount = structuredClone(report);
  invalidCandidateCount.scenarios[1]!.candidateEvaluations = 65;
  assert.deepEqual(validateBenchmarkReport(invalidCandidateCount), {
    valid: false,
    errors: ['scenarios[1].candidateEvaluations must be at most 64'],
  });

  const invalidFullScan = structuredClone(report);
  const scenario = invalidFullScan.scenarios[1]!;
  scenario.corpusSymbolsAccessed = scenario.corpusSymbolCount;
  assert.deepEqual(validateBenchmarkReport(invalidFullScan), {
    valid: false,
    errors: ['scenarios[1] records a full-corpus symbol scan'],
  });

  const unusualTiming = structuredClone(report);
  unusualTiming.scenarios[0]!.medianMilliseconds = 60_000;
  unusualTiming.scenarios[0]!.p95Milliseconds = 120_000;
  assert.equal(validateBenchmarkReport(unusualTiming).valid, true);
});

test('validator enforces the checked-in JSON schema', async () => {
  const report = await runBenchmarkSuite({ warmups: 0, iterations: 1 });
  const extraProperty = {
    ...report,
    undocumented: true,
  };

  const validation = validateBenchmarkReport(extraProperty);

  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes('additionalProperties')));
});

test('writes a validator-approved machine-readable report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'qaraa-benchmark-'));
  const output = join(directory, 'smoke.json');
  const report = await runBenchmarkSuite({ warmups: 0, iterations: 1 });

  await writeBenchmarkReport(output, report);

  const written = JSON.parse(await readFile(output, 'utf8')) as unknown;
  assert.equal(validateBenchmarkReport(written).valid, true);
});
