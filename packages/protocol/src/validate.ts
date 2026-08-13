/**
 * Strict, non-mutating Draft 2020-12 validation.
 *
 * @license Apache-2.0
 */

import {
  validateObservation,
  type QuranCorpus,
  type RecitationObservation,
  type ReadingSnapshot,
} from '@atqan/qaraa-core';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { isPlainJsonValue, QaraaProtocolError } from './errors.ts';
import type { JsonObject, QaraaErrorEnvelope } from './errors.ts';
import type { QaraaCommand, QaraaEvent } from './messages.ts';
import { PROTOCOL_SCHEMAS, SCHEMA_IDS } from './schemas.ts';

const ajv = new Ajv2020({
  allErrors: true,
  removeAdditional: false,
  strict: true,
});

for (const schema of Object.values(PROTOCOL_SCHEMAS)) ajv.addSchema(schema);

const NON_JSON_ERROR: ErrorObject = {
  instancePath: '',
  schemaPath: '#',
  keyword: 'plainJson',
  params: {},
  message: 'must be a cycle-free plain JSON value',
};

function withJsonPreflight<T>(validator: ValidateFunction<T>): ValidateFunction<T> {
  let preflightErrors: readonly ErrorObject[] | null = null;
  return new Proxy(validator, {
    apply(target, thisArgument, argumentsList: [unknown]) {
      if (!isPlainJsonValue(argumentsList[0])) {
        preflightErrors = [NON_JSON_ERROR];
        return false;
      }
      preflightErrors = null;
      return Reflect.apply(target, thisArgument, argumentsList) as boolean;
    },
    get(target, property, receiver) {
      if (property === 'errors' && preflightErrors !== null) return preflightErrors;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

function compiled<T>(id: string): ValidateFunction<T> {
  const validator = ajv.getSchema<T>(id);
  if (!validator) throw new Error(`Protocol schema was not registered: ${id}`);
  return withJsonPreflight(validator);
}

export const corpusValidator = compiled<QuranCorpus>(SCHEMA_IDS.corpus);
export const observationValidator = compiled<RecitationObservation>(SCHEMA_IDS.observation);
export const snapshotValidator = compiled<ReadingSnapshot>(SCHEMA_IDS.snapshot);
export const commandValidator = compiled<QaraaCommand>(SCHEMA_IDS.command);
export const eventValidator = compiled<QaraaEvent>(SCHEMA_IDS.event);
export const errorValidator = compiled<QaraaErrorEnvelope>(SCHEMA_IDS.error);

function schemaDetails(errors: readonly ErrorObject[] | null | undefined): JsonObject {
  return {
    kind: 'schema-validation',
    errors: (errors ?? []).map((error) => ({
      instancePath: error.instancePath,
      keyword: error.keyword,
      message: error.message ?? 'Schema validation failed',
    })),
  };
}

export function assertValidCorpus(value: unknown): asserts value is QuranCorpus {
  if (!corpusValidator(value)) {
    throw new QaraaProtocolError(
      'INVALID_CORPUS',
      'Corpus payload is invalid',
      false,
      schemaDetails(corpusValidator.errors),
    );
  }
  const symbolIds = value.symbols.map(({ id }) => id);
  const wordIds = value.words.map(({ id }) => id);
  const uniqueSymbols = new Set(symbolIds);
  if (
    uniqueSymbols.size !== symbolIds.length
    || new Set(wordIds).size !== wordIds.length
    || value.symbols.some(({ id }) => id.trim().length === 0)
    || value.words.some(({ id, symbolIds: references }) =>
      id.trim().length === 0
      || new Set(references).size !== references.length
      || references.some((reference) => reference.trim().length === 0 || !uniqueSymbols.has(reference)))
  ) {
    throw new QaraaProtocolError(
      'INVALID_CORPUS',
      'Corpus payload is invalid',
      false,
      { kind: 'domain-validation' },
    );
  }
}

export function assertValidObservation(value: unknown): asserts value is RecitationObservation {
  if (!observationValidator(value)) {
    throw new QaraaProtocolError(
      'INVALID_OBSERVATION',
      'Observation payload is invalid',
      false,
      schemaDetails(observationValidator.errors),
    );
  }
  assertObservationDomain(value);
}

function assertObservationDomain(value: RecitationObservation): void {
  try {
    validateObservation(value);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new QaraaProtocolError(
      'INVALID_OBSERVATION',
      'Observation payload is invalid',
      false,
      { kind: 'domain-validation' },
    );
  }
}

/** Validates a v1 command plus semantic observation limits without changing its wire shape. */
export function assertValidCommand(value: unknown): asserts value is QaraaCommand {
  if (!commandValidator(value)) {
    const observationCommand = value !== null
      && typeof value === 'object'
      && 'type' in value
      && value.type === 'observation.submit';
    throw new QaraaProtocolError(
      observationCommand ? 'INVALID_OBSERVATION' : 'INVALID_CORPUS',
      'Command payload is invalid',
      false,
      schemaDetails(commandValidator.errors),
    );
  }
  if (value.type === 'observation.submit') assertObservationDomain(value);
}
