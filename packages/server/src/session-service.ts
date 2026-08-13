/**
 * In-memory session lifecycle over the synchronous QARAA reading tracker.
 *
 * @license Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  createReadingTracker,
  indexCorpus,
  validateCorpus,
  validateObservation,
} from '@atqan/qaraa-core';
import type {
  IndexedCorpus,
  QuranCorpus,
  QuranLocation,
  ReadingSnapshot,
  ReadingTracker,
  ReadingTrackerOptions,
  RecitationObservation,
} from '@atqan/qaraa-core';
import {
  assertValidCorpus,
  assertValidObservation,
  PROTOCOL_VERSION,
  QaraaProtocolError,
} from '@atqan/qaraa-protocol';
import type {
  ObservationSubmitCommand,
  SessionCreateCommand,
  SessionCreatedEvent,
  SessionDeleteCommand,
  SessionDeletedEvent,
  SessionGetCommand,
  SessionResetCommand,
  SessionResumeCommand,
  SnapshotUpdatedEvent,
} from '@atqan/qaraa-protocol';
import { MemorySessionStore } from './memory-store.ts';
import type { SessionRecord, SessionStore } from './store.ts';
import { SessionRecordNotFoundError } from './store.ts';
import { TrustedProtocolError, trustProtocolError } from './trusted-error.ts';

export type CorpusResolver = (
  corpusId: string,
) => QuranCorpus | null | Promise<QuranCorpus | null>;

export type SessionServiceOptions = Readonly<{
  corpus?: QuranCorpus;
  resolveCorpus?: CorpusResolver;
  store?: SessionStore;
  createSessionId?: () => string;
  createTracker?: (options: ReadingTrackerOptions) => ReadingTracker;
  /** Maximum live sessions, including creations reserved but not yet committed. */
  maxSessions?: number;
  /** Maximum live WebSocket/subscription listeners across all sessions. */
  maxSubscribers?: number;
}>;

const SNAPSHOT_LIMIT = 256;
const OBSERVATION_ID_LIMIT = 512;
const DEFAULT_MAX_SESSIONS = 1_024;
const DEFAULT_MAX_SUBSCRIBERS = 4_096;

const CORPUS_VALIDATION_MESSAGES = [
  /^corpus must be an object$/u,
  /^corpus (?:id|revision) must be a non-empty string$/u,
  /^corpus symbols and words must be arrays$/u,
  /^symbol must be an object$/u,
  /^symbol (?:id|phoneme) must be a non-empty string$/u,
  /^symbol text must be a string$/u,
  /^symbol location(?:\.(?:surah|ayah|word|symbol))? must be (?:an address|a positive integer)$/u,
  /^duplicate symbol id$/u,
  /^symbol locations must be strictly monotonic$/u,
  /^word must be an object$/u,
  /^word id must be a non-empty string$/u,
  /^word text must be a string$/u,
  /^word must reference at least one symbol$/u,
  /^word symbol id must be a non-empty string$/u,
  /^word location(?:\.(?:surah|ayah|word))? must be (?:an address|a positive integer)$/u,
  /^duplicate word id$/u,
  /^word locations must be strictly monotonic$/u,
  /^word references missing symbol: .+$/u,
  /^word symbols must not span multiple ayat$/u,
  /^word symbols must match the word location$/u,
  /^word symbol IDs must be strictly ordered$/u,
  /^symbol is referenced by multiple words$/u,
  /^symbol is missing from its word$/u,
] as const;

const OBSERVATION_VALIDATION_MESSAGES = [
  /^observation must be an object$/u,
  /^observation id must be a non-empty string$/u,
  /^source revision must be a non-negative integer$/u,
  /^observation isFinal must be a boolean$/u,
  /^observation receivedAtMs must be a non-negative finite timestamp$/u,
  /^observation tokens must be an array$/u,
  /^partial observation must contain at least one token$/u,
  /^observation token must be an object$/u,
  /^observation token id must be a non-empty string$/u,
  /^observation token text must be a string$/u,
  /^observation token phonemes must be strings$/u,
  /^observation token (?:startMs|endMs) must be a non-negative finite timestamp$/u,
  /^observation token timestamps must not decrease$/u,
  /^observation token confidence must be finite and between 0 and 1$/u,
  /^duplicate token id$/u,
  /^observation must contain at most \d+ tokens$/u,
  /^observation must contain at most \d+ phonemes$/u,
  /^observation id must contain at most \d+ UTF-16 code units$/u,
  /^observation token (?:id|text|phoneme) must contain at most \d+ UTF-16 code units$/u,
] as const;

type SessionRuntime = Readonly<{
  tracker: ReadingTracker;
  corpus: IndexedCorpus;
}>;

export type SessionSnapshotListener = (event: SnapshotUpdatedEvent) => void;

type SessionSubscriber = Readonly<{
  requestId: string;
  listener: SessionSnapshotListener;
}>;

function freezeRecord(record: SessionRecord): SessionRecord {
  return Object.freeze({
    ...record,
    snapshots: Object.freeze([...record.snapshots]),
    observationIds: Object.freeze([...record.observationIds]),
  });
}

function sessionNotFound(sessionId: string): QaraaProtocolError {
  return new TrustedProtocolError(
    'SESSION_NOT_FOUND',
    'Session was not found',
    false,
    { sessionId },
  );
}

function isKnownDomainError(
  error: unknown,
  messages: readonly RegExp[],
): error is TypeError {
  return error instanceof TypeError && messages.some((pattern) => pattern.test(error.message));
}

function invalidDomainPayload(
  code: 'INVALID_CORPUS' | 'INVALID_OBSERVATION',
): TrustedProtocolError {
  return new TrustedProtocolError(
    code,
    code === 'INVALID_CORPUS' ? 'Corpus payload is invalid' : 'Observation payload is invalid',
    false,
    { kind: 'domain-validation' },
  );
}

function assertPositiveCapacity(value: number | undefined, label: string): number {
  const resolved = value ?? (label === 'maxSessions'
    ? DEFAULT_MAX_SESSIONS
    : DEFAULT_MAX_SUBSCRIBERS);
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return resolved;
}

function capacityExhausted(resource: 'sessions' | 'subscribers', limit: number): TrustedProtocolError {
  return new TrustedProtocolError(
    'INTERNAL_ERROR',
    resource === 'sessions' ? 'Session capacity is exhausted' : 'Subscriber capacity is exhausted',
    true,
    { kind: 'capacity', resource, limit },
  );
}

function assertDomainCorpus(corpus: QuranCorpus): void {
  try {
    validateCorpus(corpus);
  } catch (error) {
    if (isKnownDomainError(error, CORPUS_VALIDATION_MESSAGES)) {
      throw invalidDomainPayload('INVALID_CORPUS');
    }
    throw error;
  }
  if (corpus.symbols.length === 0) throw invalidDomainPayload('INVALID_CORPUS');
}

function assertDomainObservation(observation: RecitationObservation): void {
  try {
    validateObservation(observation);
  } catch (error) {
    if (isKnownDomainError(error, OBSERVATION_VALIDATION_MESSAGES)) {
      throw invalidDomainPayload('INVALID_OBSERVATION');
    }
    throw error;
  }
}

function hasLocation(corpus: IndexedCorpus, location: QuranLocation): boolean {
  return corpus.symbols.some((symbol) => (
    symbol.location.surah === location.surah
      && symbol.location.ayah === location.ayah
      && symbol.location.word === location.word
      && symbol.location.symbol === location.symbol
  ));
}

export class SessionService {
  readonly #fixedCorpus: QuranCorpus | undefined;
  #fixedIndexedCorpus: IndexedCorpus | undefined;
  #fixedIndexedCorpusTask: Promise<IndexedCorpus> | undefined;
  readonly #resolveCorpus: CorpusResolver | undefined;
  readonly #store: SessionStore;
  readonly #createSessionId: () => string;
  readonly #createTracker: (options: ReadingTrackerOptions) => ReadingTracker;
  readonly #maxSessions: number;
  readonly #maxSubscribers: number;
  readonly #sessions = new Map<string, SessionRuntime>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #subscribers = new Map<string, Set<SessionSubscriber>>();
  #reservedSessions = 0;
  #subscriberCount = 0;

  constructor(options: SessionServiceOptions) {
    if (!options.corpus && !options.resolveCorpus) {
      throw new TypeError('SessionService requires a corpus or resolveCorpus callback');
    }
    if (options.corpus) assertValidCorpus(options.corpus);
    this.#fixedCorpus = options.corpus;
    this.#resolveCorpus = options.resolveCorpus;
    this.#store = options.store ?? new MemorySessionStore();
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#createTracker = options.createTracker ?? createReadingTracker;
    this.#maxSessions = assertPositiveCapacity(options.maxSessions, 'maxSessions');
    this.#maxSubscribers = assertPositiveCapacity(options.maxSubscribers, 'maxSubscribers');
  }

  #enqueue<Result>(
    sessionId: string,
    operation: () => Result | Promise<Result>,
  ): Promise<Result> {
    const previous = this.#tails.get(sessionId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.#tails.set(sessionId, tail);
    void tail.then(() => {
      if (this.#tails.get(sessionId) === tail) this.#tails.delete(sessionId);
    });
    return result;
  }

  async #corpusFor(corpusId: string): Promise<QuranCorpus> {
    let corpus = this.#fixedCorpus?.corpusId === corpusId
      ? this.#fixedCorpus
      : null;
    if (!corpus && this.#resolveCorpus) {
      corpus = await this.#resolveCorpus(corpusId);
    }
    if (!corpus) {
      throw new TrustedProtocolError(
        'INVALID_CORPUS',
        'Corpus was not found',
        false,
        { corpusId },
      );
    }
    try {
      assertValidCorpus(corpus);
    } catch (error) {
      if (error instanceof QaraaProtocolError) throw trustProtocolError(error);
      throw error;
    }
    assertDomainCorpus(corpus);
    if (corpus.corpusId !== corpusId) {
      throw new TrustedProtocolError(
        'INVALID_CORPUS',
        'Resolved corpus identifier does not match the request',
        false,
        { corpusId },
      );
    }
    return corpus;
  }

  async #indexedCorpusFor(corpusId: string): Promise<IndexedCorpus> {
    if (this.#fixedCorpus?.corpusId === corpusId) {
      if (this.#fixedIndexedCorpus) return this.#fixedIndexedCorpus;
      if (this.#fixedIndexedCorpusTask) return this.#fixedIndexedCorpusTask;
      const task = this.#corpusFor(corpusId).then((corpus) => {
        const indexed = indexCorpus(corpus);
        this.#fixedIndexedCorpus = indexed;
        return indexed;
      });
      this.#fixedIndexedCorpusTask = task;
      void task.finally(() => {
        if (this.#fixedIndexedCorpusTask === task) this.#fixedIndexedCorpusTask = undefined;
      }).catch(() => undefined);
      return task;
    }
    const corpus = await this.#corpusFor(corpusId);
    return indexCorpus(corpus);
  }

  #reserveSession(): void {
    if (this.#sessions.size + this.#reservedSessions >= this.#maxSessions) {
      throw capacityExhausted('sessions', this.#maxSessions);
    }
    this.#reservedSessions += 1;
  }

  #releaseSessionReservation(): void {
    this.#reservedSessions -= 1;
  }

  #releaseSubscriber(sessionId: string, subscriber: SessionSubscriber): void {
    const active = this.#subscribers.get(sessionId);
    if (!active?.delete(subscriber)) return;
    this.#subscriberCount -= 1;
    if (active.size === 0) this.#subscribers.delete(sessionId);
  }

  #event(
    sessionId: string,
    requestId: string,
    snapshot: ReadingSnapshot,
  ): SnapshotUpdatedEvent {
    return Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      type: 'snapshot.updated' as const,
      sessionId,
      snapshot,
    });
  }

  #publish(sessionId: string, snapshot: ReadingSnapshot): void {
    const subscribers = this.#subscribers.get(sessionId);
    if (!subscribers) return;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber.listener(this.#event(sessionId, subscriber.requestId, snapshot));
      } catch {
        this.#releaseSubscriber(sessionId, subscriber);
      }
    }
    if (subscribers.size === 0) this.#subscribers.delete(sessionId);
  }

  create(command: SessionCreateCommand): Promise<SessionCreatedEvent> {
    const sessionId = this.#createSessionId();
    try {
      this.#reserveSession();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(sessionId, async () => {
      try {
        const indexedCorpus = await this.#indexedCorpusFor(command.corpusId);
        if (command.initialLocation !== undefined
          && !hasLocation(indexedCorpus, command.initialLocation)) {
          throw invalidDomainPayload('INVALID_CORPUS');
        }
        const tracker = this.#createTracker({
          corpus: indexedCorpus,
          ...(command.initialLocation === undefined ? {} : { initialLocation: command.initialLocation }),
          ...(command.findingMode === undefined ? {} : { findingMode: command.findingMode }),
        });
        const snapshot = tracker.getSnapshot();
        await this.#store.create(freezeRecord({
          sessionId,
          corpusId: command.corpusId,
          snapshot,
          snapshots: [snapshot],
          observationIds: [],
          latestSourceRevision: -1,
        }));
        this.#sessions.set(sessionId, { tracker, corpus: indexedCorpus });
        return Object.freeze({
          protocolVersion: PROTOCOL_VERSION,
          requestId: command.requestId,
          type: 'session.created' as const,
          sessionId,
          snapshot,
        });
      } finally {
        this.#releaseSessionReservation();
      }
    });
  }

  get(command: SessionGetCommand): Promise<SnapshotUpdatedEvent> {
    return this.#enqueue(command.sessionId, async () => {
      const record = await this.#store.get(command.sessionId);
      if (!record) throw sessionNotFound(command.sessionId);
      return Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'snapshot.updated' as const,
        sessionId: command.sessionId,
        snapshot: record.snapshot,
      });
    });
  }

  reset(command: SessionResetCommand): Promise<SnapshotUpdatedEvent> {
    return this.#enqueue(command.sessionId, async () => {
      let resetSnapshot: ReadingSnapshot | undefined;
      try {
        const runtime = this.#sessions.get(command.sessionId);
        if (!runtime) throw sessionNotFound(command.sessionId);
        if (command.location !== undefined && !hasLocation(runtime.corpus, command.location)) {
          throw invalidDomainPayload('INVALID_CORPUS');
        }
        const record = await this.#store.update(command.sessionId, (current) => {
          resetSnapshot = runtime.tracker.reset(command.location);
          return freezeRecord({
            ...current,
            snapshot: resetSnapshot,
            snapshots: [...current.snapshots, resetSnapshot].slice(-SNAPSHOT_LIMIT),
            observationIds: [],
            latestSourceRevision: -1,
          });
        });
        resetSnapshot = record.snapshot;
      } catch (error) {
        if (error instanceof SessionRecordNotFoundError) throw sessionNotFound(command.sessionId);
        throw error;
      }
      this.#publish(command.sessionId, resetSnapshot);
      return Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'snapshot.updated' as const,
        sessionId: command.sessionId,
        snapshot: resetSnapshot,
      });
    });
  }

  async submit(command: ObservationSubmitCommand): Promise<SnapshotUpdatedEvent> {
    const observation: RecitationObservation = {
      observationId: command.observationId,
      sourceRevision: command.sourceRevision,
      isFinal: command.isFinal,
      receivedAtMs: command.receivedAtMs,
      tokens: command.tokens,
    };
    try {
      assertValidObservation(observation);
    } catch (error) {
      if (error instanceof QaraaProtocolError) throw trustProtocolError(error);
      throw error;
    }
    assertDomainObservation(observation);
    return this.#enqueue(command.sessionId, async () => {
      let snapshot: ReadingSnapshot | undefined;
      let changed = false;
      try {
        const record = await this.#store.update(command.sessionId, (current) => {
          if (current.observationIds.includes(command.observationId)) {
            snapshot = current.snapshot;
            return current;
          }
          if (command.sourceRevision < current.latestSourceRevision) {
            throw new TrustedProtocolError(
              'STALE_REVISION',
              'Observation source revision is stale',
              false,
              {
                latestSourceRevision: current.latestSourceRevision,
                sourceRevision: command.sourceRevision,
              },
            );
          }
          const runtime = this.#sessions.get(command.sessionId);
          if (!runtime) throw sessionNotFound(command.sessionId);
          const previousRevision = runtime.tracker.getSnapshot().revision;
          snapshot = runtime.tracker.submit(observation);
          if (snapshot.revision === previousRevision) return current;
          changed = true;
          return freezeRecord({
            ...current,
            snapshot,
            snapshots: [...current.snapshots, snapshot].slice(-SNAPSHOT_LIMIT),
            observationIds: [...current.observationIds, command.observationId]
              .slice(-OBSERVATION_ID_LIMIT),
            latestSourceRevision: command.sourceRevision,
          });
        });
        snapshot = record.snapshot;
      } catch (error) {
        if (error instanceof SessionRecordNotFoundError) throw sessionNotFound(command.sessionId);
        throw error;
      }
      if (changed) this.#publish(command.sessionId, snapshot);
      return Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'snapshot.updated' as const,
        sessionId: command.sessionId,
        snapshot,
      });
    });
  }

  resume(command: SessionResumeCommand): Promise<readonly SnapshotUpdatedEvent[]> {
    return this.#enqueue(command.sessionId, async () => {
      const record = await this.#store.get(command.sessionId);
      if (!record) throw sessionNotFound(command.sessionId);
      return Object.freeze(record.snapshots
        .filter(({ revision }) => revision > command.lastSnapshotRevision)
        .map((snapshot) => Object.freeze({
          protocolVersion: PROTOCOL_VERSION,
          requestId: command.requestId,
          type: 'snapshot.updated' as const,
          sessionId: command.sessionId,
          snapshot,
        })));
    });
  }

  subscribe(
    command: SessionResumeCommand,
    listener: SessionSnapshotListener,
  ): Promise<() => void> {
    return this.#enqueue(command.sessionId, async () => {
      const record = await this.#store.get(command.sessionId);
      if (!record) throw sessionNotFound(command.sessionId);
      if (this.#subscriberCount >= this.#maxSubscribers) {
        throw capacityExhausted('subscribers', this.#maxSubscribers);
      }
      const subscriber = Object.freeze({ requestId: command.requestId, listener });
      const subscribers = this.#subscribers.get(command.sessionId)
        ?? new Set<SessionSubscriber>();
      subscribers.add(subscriber);
      this.#subscribers.set(command.sessionId, subscribers);
      this.#subscriberCount += 1;
      try {
        for (const replay of record.snapshots) {
          if (replay.revision > command.lastSnapshotRevision) {
            listener(this.#event(command.sessionId, command.requestId, replay));
          }
        }
      } catch (error) {
        this.#releaseSubscriber(command.sessionId, subscriber);
        throw error;
      }

      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        this.#releaseSubscriber(command.sessionId, subscriber);
      };
    });
  }

  delete(command: SessionDeleteCommand): Promise<SessionDeletedEvent> {
    return this.#enqueue(command.sessionId, async () => {
      const deleted = await this.#store.delete(command.sessionId);
      if (!deleted) throw sessionNotFound(command.sessionId);
      this.#sessions.delete(command.sessionId);
      const subscribers = this.#subscribers.get(command.sessionId);
      if (subscribers) this.#subscriberCount -= subscribers.size;
      this.#subscribers.delete(command.sessionId);
      return Object.freeze({
        protocolVersion: PROTOCOL_VERSION,
        requestId: command.requestId,
        type: 'session.deleted' as const,
        sessionId: command.sessionId,
      });
    });
  }
}
