/**
 * Structural and bounded-operation validation for benchmark JSON.
 *
 * @license Apache-2.0
 */

import { SCENARIO_NAMES } from './scenarios.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import benchmarkReportSchema from '../schema/benchmark-report.schema.json' with { type: 'json' };

export type BenchmarkScenarioResult = {
  scenario: typeof SCENARIO_NAMES[number];
  medianMilliseconds: number;
  p95Milliseconds: number;
  heapDeltaBytes: number;
  candidateEvaluations: number;
  editCells: number;
  corpusSymbolsAccessed: number;
  corpusSymbolCount: number;
};

export type BenchmarkReport = {
  schemaVersion: 1;
  runtime: {
    node: string;
    v8: string;
    platform: string;
    architecture: string;
  };
  config: {
    warmups: number;
    iterations: number;
  };
  scenarios: BenchmarkScenarioResult[];
};

export type ValidationResult = Readonly<{
  valid: boolean;
  errors: readonly string[];
}>;

const schemaValidator = new Ajv2020({ allErrors: true, strict: true }).compile<BenchmarkReport>(
  benchmarkReportSchema,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function validateBenchmarkReport(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['report must be an object'] };
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');

  if (!isRecord(value.runtime)
    || typeof value.runtime.node !== 'string'
    || typeof value.runtime.v8 !== 'string'
    || typeof value.runtime.platform !== 'string'
    || typeof value.runtime.architecture !== 'string') {
    errors.push('runtime must contain node, v8, platform, and architecture strings');
  }

  if (!isRecord(value.config)
    || !isNonNegativeInteger(value.config.warmups)
    || !isNonNegativeInteger(value.config.iterations)
    || value.config.iterations < 1) {
    errors.push('config must contain non-negative warmups and positive iterations');
  }

  if (!Array.isArray(value.scenarios) || value.scenarios.length !== SCENARIO_NAMES.length) {
    errors.push('scenarios must contain exactly six entries');
    return { valid: errors.length === 0, errors };
  }

  for (const [index, expectedName] of SCENARIO_NAMES.entries()) {
    const scenario = value.scenarios[index];
    if (!isRecord(scenario)) {
      errors.push(`scenarios[${index}] must be an object`);
      continue;
    }
    if (scenario.scenario !== expectedName) {
      errors.push(`scenarios[${index}].scenario must be ${expectedName}`);
    }
    if (!isNonNegativeFinite(scenario.medianMilliseconds)) {
      errors.push(`scenarios[${index}].medianMilliseconds must be non-negative and finite`);
    }
    if (!isNonNegativeFinite(scenario.p95Milliseconds)) {
      errors.push(`scenarios[${index}].p95Milliseconds must be non-negative and finite`);
    } else if (isNonNegativeFinite(scenario.medianMilliseconds)
      && scenario.p95Milliseconds < scenario.medianMilliseconds) {
      errors.push(`scenarios[${index}].p95Milliseconds must not be below the median`);
    }
    if (typeof scenario.heapDeltaBytes !== 'number'
      || !Number.isSafeInteger(scenario.heapDeltaBytes)) {
      errors.push(`scenarios[${index}].heapDeltaBytes must be an integer`);
    }
    for (const field of [
      'candidateEvaluations',
      'editCells',
      'corpusSymbolsAccessed',
      'corpusSymbolCount',
    ] as const) {
      if (!isNonNegativeInteger(scenario[field])) {
        errors.push(`scenarios[${index}].${field} must be a non-negative integer`);
      }
    }
    if (isNonNegativeInteger(scenario.candidateEvaluations)
      && scenario.candidateEvaluations > 64) {
      errors.push(`scenarios[${index}].candidateEvaluations must be at most 64`);
    }
    if (isNonNegativeInteger(scenario.candidateEvaluations)
      && scenario.candidateEvaluations > 0
      && isNonNegativeInteger(scenario.corpusSymbolsAccessed)
      && isNonNegativeInteger(scenario.corpusSymbolCount)
      && scenario.corpusSymbolsAccessed >= scenario.corpusSymbolCount) {
      errors.push(`scenarios[${index}] records a full-corpus symbol scan`);
    }
  }

  if (errors.length === 0 && !schemaValidator(value)) {
    for (const error of schemaValidator.errors ?? []) {
      errors.push(`${error.instancePath || 'report'} ${error.keyword}: ${error.message ?? 'invalid'}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertBenchmarkReport(value: unknown): asserts value is BenchmarkReport {
  const result = validateBenchmarkReport(value);
  if (!result.valid) throw new TypeError(result.errors.join('; '));
}
