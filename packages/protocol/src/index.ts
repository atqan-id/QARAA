/**
 * QARAA protocol v1 contracts, schemas, validators, and typed errors.
 *
 * @license Apache-2.0
 */

export { PROTOCOL_VERSION } from './version.ts';
export type { ProtocolVersion } from './version.ts';
export { QaraaProtocolError } from './errors.ts';
export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  QaraaErrorCode,
  QaraaErrorEnvelope,
} from './errors.ts';
export type {
  CommandEnvelope,
  EventEnvelope,
  ObservationSubmitCommand,
  ProtocolEnvelope,
  QaraaCommand,
  QaraaEvent,
  SessionCreateCommand,
  SessionCreatedEvent,
  SessionDeleteCommand,
  SessionDeletedEvent,
  SessionGetCommand,
  SessionResetCommand,
  SessionResumeCommand,
  SnapshotUpdatedEvent,
} from './messages.ts';
export {
  commandSchema,
  corpusSchema,
  errorSchema,
  eventSchema,
  observationSchema,
  PROTOCOL_SCHEMAS,
  SCHEMA_IDS,
  snapshotSchema,
} from './schemas.ts';
export {
  assertValidCommand,
  assertValidCorpus,
  assertValidObservation,
  commandValidator,
  corpusValidator,
  errorValidator,
  eventValidator,
  observationValidator,
  snapshotValidator,
} from './validate.ts';
