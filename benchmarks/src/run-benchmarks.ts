/**
 * Reproducible benchmark runner with operation-count evidence.
 *
 * @license Apache-2.0
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { createBenchmarkScenarios, SCENARIO_NAMES } from './scenarios.ts';
import {
  assertBenchmarkReport,
  type BenchmarkReport,
  type BenchmarkScenarioResult,
} from './validate-report.ts';

export const BENCHMARK_SCENARIOS = SCENARIO_NAMES;

export type BenchmarkOptions = Readonly<{
  warmups: number;
  iterations: number;
}>;

export function defaultBenchmarkOptions(): BenchmarkOptions {
  return { warmups: 20, iterations: 100 };
}

function percentile(sortedValues: readonly number[], percentileValue: number): number {
  const index = Math.max(0, Math.ceil(percentileValue * sortedValues.length) - 1);
  return sortedValues[index]!;
}

function median(sortedValues: readonly number[]): number {
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 1
    ? sortedValues[middle]!
    : (sortedValues[middle - 1]! + sortedValues[middle]!) / 2;
}

export async function runBenchmarkSuite(options: BenchmarkOptions): Promise<BenchmarkReport> {
  if (!Number.isSafeInteger(options.warmups) || options.warmups < 0) {
    throw new TypeError('warmups must be a non-negative integer');
  }
  if (!Number.isSafeInteger(options.iterations) || options.iterations < 1) {
    throw new TypeError('iterations must be a positive integer');
  }

  const results: BenchmarkScenarioResult[] = [];
  for (const scenario of createBenchmarkScenarios()) {
    for (let iteration = 0; iteration < options.warmups; iteration += 1) {
      scenario.prepare(iteration).run();
    }

    const durations: number[] = [];
    const heapDeltas: number[] = [];
    let candidateEvaluations = 0;
    let editCells = 0;
    let corpusSymbolsAccessed = 0;
    let corpusSymbolCount = 0;
    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
      const prepared = scenario.prepare(options.warmups + iteration);
      const heapBefore = process.memoryUsage().heapUsed;
      const startedAt = performance.now();
      prepared.run();
      durations.push(performance.now() - startedAt);
      heapDeltas.push(process.memoryUsage().heapUsed - heapBefore);
      const operations = prepared.operationCounts();
      candidateEvaluations = Math.max(candidateEvaluations, operations.candidateEvaluations);
      editCells = Math.max(editCells, operations.editCells);
      corpusSymbolsAccessed = Math.max(
        corpusSymbolsAccessed,
        operations.corpusSymbolsAccessed,
      );
      corpusSymbolCount = Math.max(corpusSymbolCount, operations.corpusSymbolCount);
    }
    durations.sort((left, right) => left - right);
    heapDeltas.sort((left, right) => left - right);
    results.push({
      scenario: scenario.name,
      medianMilliseconds: median(durations),
      p95Milliseconds: percentile(durations, 0.95),
      heapDeltaBytes: Math.round(median(heapDeltas)),
      candidateEvaluations,
      editCells,
      corpusSymbolsAccessed,
      corpusSymbolCount,
    });
  }

  const report: BenchmarkReport = {
    schemaVersion: 1,
    runtime: {
      node: process.versions.node,
      v8: process.versions.v8,
      platform: process.platform,
      architecture: process.arch,
    },
    config: { ...options },
    scenarios: results,
  };
  assertBenchmarkReport(report);
  return report;
}

export async function writeBenchmarkReport(
  outputPath: string,
  report: BenchmarkReport,
): Promise<void> {
  assertBenchmarkReport(report);
  const absoluteOutput = resolve(outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

type CliOptions = Readonly<BenchmarkOptions & { output: string }>;

function parseInteger(value: string | undefined, flag: string): number {
  if (value === undefined || !/^\d+$/.test(value)) throw new TypeError(`${flag} requires an integer`);
  return Number(value);
}

function parseCli(argumentsToParse: readonly string[]): CliOptions {
  const defaults = defaultBenchmarkOptions();
  let warmups = defaults.warmups;
  let iterations = defaults.iterations;
  let output = '.benchmark-results/local.json';
  for (let index = 0; index < argumentsToParse.length; index += 1) {
    const argument = argumentsToParse[index];
    if (argument === '--') continue;
    if (argument === '--warmups') {
      warmups = parseInteger(argumentsToParse[index + 1], '--warmups');
      index += 1;
    } else if (argument === '--iterations') {
      iterations = parseInteger(argumentsToParse[index + 1], '--iterations');
      index += 1;
    } else if (argument === '--output') {
      const value = argumentsToParse[index + 1];
      if (!value) throw new TypeError('--output requires a path');
      output = value;
      index += 1;
    } else {
      throw new TypeError(`unknown argument: ${argument}`);
    }
  }
  return { warmups, iterations, output };
}

async function main(): Promise<void> {
  const { output, warmups, iterations } = parseCli(process.argv.slice(2));
  const report = await runBenchmarkSuite({ warmups, iterations });
  await writeBenchmarkReport(output, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
