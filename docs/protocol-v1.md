# Protocol v1

`PROTOCOL_VERSION` is the numeric literal `1`. Every command and event contains `protocolVersion`, `requestId`, and a discriminating `type`. Protocol compatibility is independent of package semver.

## Commands

| Type | Required payload beyond the envelope | Purpose |
| --- | --- | --- |
| `session.create` | `corpusId`; optional `initialLocation`, `findingMode` | Create an in-memory session |
| `session.get` | `sessionId` | Read the current snapshot |
| `session.reset` | `sessionId`; optional `location` | Reset tracker state and increment snapshot revision |
| `observation.submit` | `sessionId` plus the observation fields | Submit normalized recognition evidence |
| `session.resume` | `sessionId`, `lastSnapshotRevision` | Replay newer snapshots and subscribe to updates |
| `session.delete` | `sessionId` | Remove the session |

An observation contains `observationId`, non-negative `sourceRevision`, `isFinal`, non-negative finite `receivedAtMs`, and token objects. Tokens contain stable IDs, text, phonemes, optional ordered millisecond timestamps, and optional confidence in `[0, 1]`.

### Observation resource limits

Protocol v1 schemas remain shape contracts, so these semantic ceilings do not change the serialized wire shape. `assertValidObservation`, `assertValidCommand`, direct core validation/location/tracking, and the server enforce them before candidate retrieval or alignment workspace allocation:

| Resource | Maximum |
| --- | ---: |
| Tokens per observation | 64 |
| Aggregate phonemes per observation | 128 |
| Observation ID | 256 UTF-16 code units |
| Token ID | 256 UTF-16 code units |
| Token text | 1,024 UTF-16 code units |
| One phoneme string | 128 UTF-16 code units |

The exact maximum is accepted. A value above any ceiling is invalid; protocol and server boundaries return `INVALID_OBSERVATION`. These are safety limits, not recommended streaming chunk sizes.

## Events

| Type | Payload | Meaning |
| --- | --- | --- |
| `session.created` | `sessionId`, `snapshot` | Session creation completed |
| `snapshot.updated` | `sessionId`, `snapshot` | Current, submitted, reset, resumed, or streamed state |
| `session.deleted` | `sessionId` | Session deletion completed |
| `error` | `code`, `message`, `retryable`, JSON-safe `details` | Typed failure |

Error codes are `INVALID_CORPUS`, `INVALID_OBSERVATION`, `STALE_REVISION`, `UNSUPPORTED_PROTOCOL`, `SESSION_NOT_FOUND`, and `INTERNAL_ERROR`.

## HTTP and WebSocket transport

| Method | Path | Protocol operation |
| --- | --- | --- |
| `POST` | `/v1/sessions` | `session.create` body |
| `GET` | `/v1/sessions/:sessionId` | `session.get`; version/request ID may be query/header supplied |
| `POST` | `/v1/sessions/:sessionId/reset` | `session.reset` body |
| `POST` | `/v1/sessions/:sessionId/observations` | `observation.submit` body |
| `POST` | `/v1/sessions/:sessionId/resume` | `session.resume` body |
| `DELETE` | `/v1/sessions/:sessionId` | `session.delete`; version/request ID may be query/header supplied |
| WebSocket | `/v1/sessions/:sessionId/stream` | Query: `protocolVersion`, `lastSnapshotRevision`, optional `requestId` |

WebSocket negotiation defaults to protocol v1 and revision `0` when omitted. Invalid negotiation closes with code `4406`; a missing session closes with `4404`; an unexpected internal stream failure closes with `1011`. Before closing for a negotiated protocol error, the server attempts to send a typed error envelope.

## Idempotency and revisions

Observation submission is idempotent by `observationId`. The tracker ignores IDs it has already retained and source revisions older than its latest accepted revision. Server storage also retains bounded observation-ID history. Clients ignore delayed snapshots whose revision is not newer than their current snapshot.

A successful reset clears retained observation IDs on the core, server, local-client, and remote-client paths. The remote client serializes mutation acknowledgements across reset, so a pre-reset response cannot restore stale deduplication state and the same observation ID may be reused afterward.

`session.resume` replays retained snapshots newer than `lastSnapshotRevision`; it is not a promise of unbounded history or durable recovery.

## Schemas and validation

The package exports schema objects and validators for corpus, observation, snapshot, command, event, and error. JSON schema files are also exported at `@atqan/qaraa-protocol/schemas/v1/*.schema.json`. The canonical repository copies live under `schemas/v1`, and CI checks canonical/semantic JSON equality with package sources; whitespace and object-key order are intentionally ignored.

Conformance inputs live in `conformance/v1`. Valid fixtures must satisfy their declared schema and invalid fixtures must be rejected. A serialized breaking change must introduce a new protocol directory/version instead of silently changing v1.
