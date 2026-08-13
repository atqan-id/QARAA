/**
 * Public schema objects used by validators and package consumers.
 *
 * @license Apache-2.0
 */

import corpusSchema from './schemas/v1/corpus.schema.json' with { type: 'json' };
import observationSchema from './schemas/v1/observation.schema.json' with { type: 'json' };
import snapshotSchema from './schemas/v1/snapshot.schema.json' with { type: 'json' };
import commandSchema from './schemas/v1/command.schema.json' with { type: 'json' };
import eventSchema from './schemas/v1/event.schema.json' with { type: 'json' };
import errorSchema from './schemas/v1/error.schema.json' with { type: 'json' };

export const SCHEMA_IDS = {
  corpus: 'urn:atqan:qaraa:protocol:v1:corpus',
  observation: 'urn:atqan:qaraa:protocol:v1:observation',
  snapshot: 'urn:atqan:qaraa:protocol:v1:snapshot',
  command: 'urn:atqan:qaraa:protocol:v1:command',
  event: 'urn:atqan:qaraa:protocol:v1:event',
  error: 'urn:atqan:qaraa:protocol:v1:error',
} as const;

export {
  commandSchema,
  corpusSchema,
  errorSchema,
  eventSchema,
  observationSchema,
  snapshotSchema,
};

export const PROTOCOL_SCHEMAS = {
  corpus: corpusSchema,
  observation: observationSchema,
  snapshot: snapshotSchema,
  command: commandSchema,
  event: eventSchema,
  error: errorSchema,
} as const;
