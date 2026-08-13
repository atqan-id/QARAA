/**
 * JSON-safe command and event envelopes for QARAA protocol v1.
 *
 * @license Apache-2.0
 */

import type {
  FindingMode,
  QuranLocation,
  RecitationObservation,
  ReadingSnapshot,
} from '@atqan/qaraa-core';
import type { QaraaErrorEnvelope } from './errors.ts';
import type { ProtocolVersion } from './version.ts';

export type ProtocolEnvelope = Readonly<{
  protocolVersion: ProtocolVersion;
  requestId: string;
}>;

export type SessionCreateCommand = ProtocolEnvelope & Readonly<{
  type: 'session.create';
  corpusId: string;
  initialLocation?: QuranLocation;
  findingMode?: FindingMode;
}>;

export type SessionGetCommand = ProtocolEnvelope & Readonly<{
  type: 'session.get';
  sessionId: string;
}>;

export type SessionResetCommand = ProtocolEnvelope & Readonly<{
  type: 'session.reset';
  sessionId: string;
  location?: QuranLocation;
}>;

export type SessionDeleteCommand = ProtocolEnvelope & Readonly<{
  type: 'session.delete';
  sessionId: string;
}>;

/** Observation metadata stays top-level so every SDK can deduplicate before decoding tokens. */
export type ObservationSubmitCommand = ProtocolEnvelope & RecitationObservation & Readonly<{
  type: 'observation.submit';
  sessionId: string;
}>;

export type SessionResumeCommand = ProtocolEnvelope & Readonly<{
  type: 'session.resume';
  sessionId: string;
  lastSnapshotRevision: number;
}>;

export type QaraaCommand =
  | SessionCreateCommand
  | SessionGetCommand
  | SessionResetCommand
  | SessionDeleteCommand
  | ObservationSubmitCommand
  | SessionResumeCommand;

export type SessionCreatedEvent = ProtocolEnvelope & Readonly<{
  type: 'session.created';
  sessionId: string;
  snapshot: ReadingSnapshot;
}>;

export type SnapshotUpdatedEvent = ProtocolEnvelope & Readonly<{
  type: 'snapshot.updated';
  sessionId: string;
  snapshot: ReadingSnapshot;
}>;

export type SessionDeletedEvent = ProtocolEnvelope & Readonly<{
  type: 'session.deleted';
  sessionId: string;
}>;

export type QaraaEvent =
  | SessionCreatedEvent
  | SnapshotUpdatedEvent
  | SessionDeletedEvent
  | QaraaErrorEnvelope;

export type CommandEnvelope = QaraaCommand;
export type EventEnvelope = QaraaEvent;
