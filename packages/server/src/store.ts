/**
 * Storage boundary for QARAA session lifecycle state.
 *
 * @license Apache-2.0
 */

import type { ReadingSnapshot } from '@atqan/qaraa-core';

export type SessionRecord = Readonly<{
  sessionId: string;
  corpusId: string;
  snapshot: ReadingSnapshot;
  snapshots: readonly ReadingSnapshot[];
  observationIds: readonly string[];
  latestSourceRevision: number;
}>;

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  get(sessionId: string): Promise<SessionRecord | null>;
  update(
    sessionId: string,
    mutate: (record: SessionRecord) => SessionRecord,
  ): Promise<SessionRecord>;
  delete(sessionId: string): Promise<boolean>;
}

export class SessionRecordNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session record was not found: ${sessionId}`);
    this.name = 'SessionRecordNotFoundError';
    this.sessionId = sessionId;
  }
}

export class SessionRecordExistsError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session record already exists: ${sessionId}`);
    this.name = 'SessionRecordExistsError';
    this.sessionId = sessionId;
  }
}
