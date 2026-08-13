/**
 * Compile-time equality between public protocol declarations and wire shapes.
 *
 * @license Apache-2.0
 */

import type {
  ConfidenceEvidence,
  ConfirmedFinding,
  FindingMode,
  ObservationToken,
  QuranCorpus,
  QuranLocation,
  QuranSymbol,
  QuranWord,
  RecitationObservation,
  ReadingSnapshot,
} from '@atqan/qaraa-core';
import type {
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
} from '../src/messages.ts';
import type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  QaraaErrorCode,
  QaraaErrorEnvelope,
} from '../src/errors.ts';
import type { ProtocolVersion } from '../src/version.ts';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false;

type Assert<Value extends true> = Value;

type ExpectedProtocolEnvelope = Readonly<{
  protocolVersion: 1;
  requestId: string;
}>;

type ExpectedQuranLocation = Readonly<{
  surah: number;
  ayah: number;
  word: number;
  symbol: number;
}>;

type ExpectedQuranSymbol = Readonly<{
  id: string;
  text: string;
  phoneme: string;
  location: ExpectedQuranLocation;
}>;

type ExpectedQuranWord = Readonly<{
  id: string;
  text: string;
  symbolIds: readonly string[];
  location: Readonly<{
    surah: number;
    ayah: number;
    word: number;
  }>;
}>;

type ExpectedQuranCorpus = Readonly<{
  corpusId: string;
  revision: string;
  symbols: readonly ExpectedQuranSymbol[];
  words: readonly ExpectedQuranWord[];
}>;

type ExpectedFindingMode = 'off' | 'substitutions';

type ExpectedObservationToken = Readonly<{
  id: string;
  text: string;
  phonemes: readonly string[];
  startMs?: number;
  endMs?: number;
  confidence?: number;
}>;

type ExpectedObservation = Readonly<{
  observationId: string;
  sourceRevision: number;
  isFinal: boolean;
  receivedAtMs: number;
  tokens: readonly ExpectedObservationToken[];
}>;

type ExpectedConfidence = Readonly<{
  alignment: number;
  stability: number;
  lookahead: number;
  matchedLookaheadCount: number;
  margin: number;
  acoustic: number | null;
  combined: number;
}>;

type ExpectedFinding = Readonly<{
  type: 'substitution';
  confirmation: 'immediate' | 'final' | 'soft';
  observationId: string;
  operation: Readonly<{
    kind: 'substitution';
    actualIndex: number;
    referenceIndex: number;
    score: number;
  }>;
  actualPhoneme: string;
  referencePhoneme: string;
  referenceSymbolId: string;
  location: ExpectedQuranLocation;
  confidence: ExpectedConfidence;
  confirmations: number;
}>;

type ExpectedSnapshot = Readonly<{
  revision: number;
  observationId: string | null;
  display: Readonly<{
    location: ExpectedQuranLocation;
    isReread: boolean;
    activeWordId: string | null;
  }>;
  commit: Readonly<{
    location: ExpectedQuranLocation;
    completedWordIds: readonly string[];
  }>;
  confidence: ExpectedConfidence | null;
  finding: ExpectedFinding | null;
}>;

type ExpectedSessionCreate = ExpectedProtocolEnvelope & Readonly<{
  type: 'session.create';
  corpusId: string;
  initialLocation?: ExpectedQuranLocation;
  findingMode?: ExpectedFindingMode;
}>;

type ExpectedSessionGet = ExpectedProtocolEnvelope & Readonly<{
  type: 'session.get';
  sessionId: string;
}>;

type ExpectedSessionReset = ExpectedProtocolEnvelope & Readonly<{
  type: 'session.reset';
  sessionId: string;
  location?: ExpectedQuranLocation;
}>;

type ExpectedSessionDelete = ExpectedProtocolEnvelope & Readonly<{
  type: 'session.delete';
  sessionId: string;
}>;

type ExpectedObservationSubmit = ExpectedProtocolEnvelope & ExpectedObservation & Readonly<{
  type: 'observation.submit';
  sessionId: string;
}>;

type ExpectedSessionResume = ExpectedProtocolEnvelope & Readonly<{
  type: 'session.resume';
  sessionId: string;
  lastSnapshotRevision: number;
}>;

type ExpectedCommand =
  | ExpectedSessionCreate
  | ExpectedSessionGet
  | ExpectedSessionReset
  | ExpectedSessionDelete
  | ExpectedObservationSubmit
  | ExpectedSessionResume;

type ExpectedSessionCreated = ExpectedProtocolEnvelope & Readonly<{
  type: 'session.created';
  sessionId: string;
  snapshot: ExpectedSnapshot;
}>;

type ExpectedSnapshotUpdated = ExpectedProtocolEnvelope & Readonly<{
  type: 'snapshot.updated';
  sessionId: string;
  snapshot: ExpectedSnapshot;
}>;

type ExpectedSessionDeleted = ExpectedProtocolEnvelope & Readonly<{
  type: 'session.deleted';
  sessionId: string;
}>;

type ExpectedErrorCode =
  | 'INVALID_CORPUS'
  | 'INVALID_OBSERVATION'
  | 'STALE_REVISION'
  | 'UNSUPPORTED_PROTOCOL'
  | 'SESSION_NOT_FOUND'
  | 'INTERNAL_ERROR';

type ExpectedJsonPrimitive = string | number | boolean | null;
type ExpectedJsonValue =
  | ExpectedJsonPrimitive
  | ExpectedJsonObject
  | readonly ExpectedJsonValue[];
type ExpectedJsonObject = Readonly<{ [key: string]: ExpectedJsonValue }>;

type ExpectedErrorEnvelope = Readonly<{
  protocolVersion: 1;
  requestId: string;
  type: 'error';
  code: ExpectedErrorCode;
  message: string;
  retryable: boolean;
  details: ExpectedJsonObject;
}>;

type ExpectedEvent =
  | ExpectedSessionCreated
  | ExpectedSnapshotUpdated
  | ExpectedSessionDeleted
  | ExpectedErrorEnvelope;

type ProtocolV1TypeAssertions = [
  Assert<Equal<ProtocolVersion, 1>>,
  Assert<Equal<QuranLocation, ExpectedQuranLocation>>,
  Assert<Equal<QuranSymbol, ExpectedQuranSymbol>>,
  Assert<Equal<QuranWord, ExpectedQuranWord>>,
  Assert<Equal<QuranCorpus, ExpectedQuranCorpus>>,
  Assert<Equal<FindingMode, ExpectedFindingMode>>,
  Assert<Equal<ObservationToken, ExpectedObservationToken>>,
  Assert<Equal<RecitationObservation, ExpectedObservation>>,
  Assert<Equal<ConfidenceEvidence, ExpectedConfidence>>,
  Assert<Equal<ConfirmedFinding, ExpectedFinding>>,
  Assert<Equal<ReadingSnapshot, ExpectedSnapshot>>,
  Assert<Equal<ProtocolEnvelope, ExpectedProtocolEnvelope>>,
  Assert<Equal<SessionCreateCommand, ExpectedSessionCreate>>,
  Assert<Equal<SessionGetCommand, ExpectedSessionGet>>,
  Assert<Equal<SessionResetCommand, ExpectedSessionReset>>,
  Assert<Equal<SessionDeleteCommand, ExpectedSessionDelete>>,
  Assert<Equal<ObservationSubmitCommand, ExpectedObservationSubmit>>,
  Assert<Equal<SessionResumeCommand, ExpectedSessionResume>>,
  Assert<Equal<QaraaCommand, ExpectedCommand>>,
  Assert<Equal<CommandEnvelope, ExpectedCommand>>,
  Assert<Equal<QaraaCommand['type'],
    | 'session.create'
    | 'session.get'
    | 'session.reset'
    | 'session.delete'
    | 'observation.submit'
    | 'session.resume'>>,
  Assert<Equal<SessionCreatedEvent, ExpectedSessionCreated>>,
  Assert<Equal<SnapshotUpdatedEvent, ExpectedSnapshotUpdated>>,
  Assert<Equal<SessionDeletedEvent, ExpectedSessionDeleted>>,
  Assert<Equal<JsonPrimitive, ExpectedJsonPrimitive>>,
  Assert<Equal<JsonValue, ExpectedJsonValue>>,
  Assert<Equal<JsonObject, ExpectedJsonObject>>,
  Assert<Equal<QaraaErrorCode, ExpectedErrorCode>>,
  Assert<Equal<QaraaErrorEnvelope, ExpectedErrorEnvelope>>,
  Assert<Equal<QaraaEvent, ExpectedEvent>>,
  Assert<Equal<EventEnvelope, ExpectedEvent>>,
  Assert<Equal<QaraaEvent['type'], 'session.created' | 'snapshot.updated' | 'session.deleted' | 'error'>>,
];

export type { ProtocolV1TypeAssertions };
