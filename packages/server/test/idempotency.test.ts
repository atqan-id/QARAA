/**
 * Session ordering, reconnect cache, and transport idempotency regressions.
 *
 * @license Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadingTracker } from '@atqan/qaraa-core';
import type { QuranCorpus, ReadingSnapshot } from '@atqan/qaraa-core';
import { QaraaProtocolError } from '@atqan/qaraa-protocol';
import type { QaraaErrorEnvelope, SnapshotUpdatedEvent } from '@atqan/qaraa-protocol';
import {
  createQaraaServer,
  MemorySessionStore,
  SessionService,
} from '../src/index.ts';
import type { SessionRecord } from '../src/index.ts';
import type { SessionStore } from '../src/index.ts';

const corpus: QuranCorpus = {
  corpusId: 'idempotency-corpus',
  revision: '1',
  symbols: [
    {
      id: 'symbol-1',
      text: 'بِ',
      phoneme: 'bi',
      location: { surah: 1, ayah: 1, word: 1, symbol: 1 },
    },
  ],
  words: [
    {
      id: 'word-1',
      text: 'بِ',
      symbolIds: ['symbol-1'],
      location: { surah: 1, ayah: 1, word: 1 },
    },
  ],
};

function observationPayload(
  sessionId: string,
  observationId: string,
  sourceRevision: number,
  requestId = `request-${observationId}`,
) {
  return {
    protocolVersion: 1,
    requestId,
    type: 'observation.submit',
    sessionId,
    observationId,
    sourceRevision,
    isFinal: true,
    receivedAtMs: sourceRevision,
    tokens: [{ id: `token-${observationId}`, text: 'بِ', phonemes: ['bi'] }],
  } as const;
}

function record(sessionId: string, revision = 0): SessionRecord {
  const location = { surah: 1, ayah: 1, word: 1, symbol: 1 };
  const snapshot: ReadingSnapshot = {
    revision,
    observationId: null,
    display: { location, isReread: false, activeWordId: null },
    commit: { location, completedWordIds: [] },
    confidence: null,
    finding: null,
  };
  return {
    sessionId,
    corpusId: corpus.corpusId,
    snapshot,
    snapshots: [snapshot],
    observationIds: [],
    latestSourceRevision: -1,
  };
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

class YieldingSessionStore implements SessionStore {
  readonly #inner = new MemorySessionStore();
  #createYield: Readonly<{
    committed: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
  }> | undefined;
  #deleteYield: Readonly<{
    committed: ReturnType<typeof deferred>;
    release: ReturnType<typeof deferred>;
  }> | undefined;

  yieldNextCreate() {
    const gates = { committed: deferred(), release: deferred() };
    this.#createYield = gates;
    return gates;
  }

  yieldNextDelete() {
    const gates = { committed: deferred(), release: deferred() };
    this.#deleteYield = gates;
    return gates;
  }

  async create(value: SessionRecord): Promise<void> {
    await this.#inner.create(value);
    const gates = this.#createYield;
    if (!gates) return;
    this.#createYield = undefined;
    gates.committed.resolve();
    await gates.release.promise;
  }

  get(sessionId: string): Promise<SessionRecord | null> {
    return this.#inner.get(sessionId);
  }

  update(
    sessionId: string,
    mutate: (value: SessionRecord) => SessionRecord,
  ): Promise<SessionRecord> {
    return this.#inner.update(sessionId, mutate);
  }

  async delete(sessionId: string): Promise<boolean> {
    const deleted = await this.#inner.delete(sessionId);
    const gates = this.#deleteYield;
    if (!gates) return deleted;
    this.#deleteYield = undefined;
    gates.committed.resolve();
    await gates.release.promise;
    return deleted;
  }
}

function createCommand(requestId = 'request-create') {
  return {
    protocolVersion: 1,
    requestId,
    type: 'session.create',
    corpusId: corpus.corpusId,
  } as const;
}

test('serializes updates in call order and continues after a rejected mutation', async () => {
  const store = new MemorySessionStore();
  await store.create(record('ordered'));
  const mutations: string[] = [];

  const rejected = store.update('ordered', () => {
    mutations.push('first');
    throw new Error('expected rejection');
  });
  const accepted = store.update('ordered', (current) => {
    mutations.push('second');
    return { ...current, latestSourceRevision: 2 };
  });

  await assert.rejects(rejected, /expected rejection/u);
  assert.equal((await accepted).latestSourceRevision, 2);
  assert.deepEqual(mutations, ['first', 'second']);
  assert.equal((await store.get('ordered'))?.latestSourceRevision, 2);
});

test('keeps submit behind the complete record and tracker create lifecycle', async () => {
  const store = new YieldingSessionStore();
  const gates = store.yieldNextCreate();
  const service = new SessionService({
    corpus,
    store,
    createSessionId: () => 'session-create-race',
  });

  const creating = service.create(createCommand());
  let submitSettled = false;
  const submitting = service.submit(
    observationPayload('session-create-race', 'observation-after-create', 1),
  ).then(
    (value) => ({ value } as const),
    (error: unknown) => ({ error } as const),
  ).finally(() => {
    submitSettled = true;
  });
  await gates.committed.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(submitSettled, false);
  gates.release.resolve();
  const [created, submitResult] = await Promise.all([creating, submitting]);
  assert.ok('value' in submitResult);
  assert.equal(created.sessionId, 'session-create-race');
  assert.equal(submitResult.value.snapshot.revision, 1);
});

test('keeps delete, same-ID recreate, and submit in one service-owned order', async () => {
  const store = new YieldingSessionStore();
  const service = new SessionService({
    corpus,
    store,
    createSessionId: () => 'session-recreated',
  });
  await service.create(createCommand('request-initial-create'));
  const gates = store.yieldNextDelete();
  const deleting = service.delete({
    protocolVersion: 1,
    requestId: 'request-delete',
    type: 'session.delete',
    sessionId: 'session-recreated',
  });
  await gates.committed.promise;
  let recreateSettled = false;
  const recreating = service.create(createCommand('request-recreate')).finally(() => {
    recreateSettled = true;
  });
  let submitSettled = false;
  const submitting = service.submit(observationPayload(
    'session-recreated',
    'observation-after-recreate',
    1,
  )).then(
    (value) => ({ value } as const),
    (error: unknown) => ({ error } as const),
  ).finally(() => {
    submitSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(recreateSettled, false);
  assert.equal(submitSettled, false);
  gates.release.resolve();
  const [, , submitResult] = await Promise.all([deleting, recreating, submitting]);
  assert.ok('value' in submitResult);
  assert.equal(submitResult.value.snapshot.revision, 1);
});

test('deduplicates concurrent observations before the tracker can advance twice', async (context) => {
  const server = createQaraaServer({
    corpus,
    createSessionId: () => 'session-idempotent',
  });
  context.after(() => server.close());
  await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-create',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });

  const [first, duplicate] = await Promise.all([
    server.inject({
      method: 'POST',
      url: '/v1/sessions/session-idempotent/observations',
      payload: observationPayload('session-idempotent', 'duplicate', 1, 'request-first'),
    }),
    server.inject({
      method: 'POST',
      url: '/v1/sessions/session-idempotent/observations',
      payload: observationPayload('session-idempotent', 'duplicate', 2, 'request-duplicate'),
    }),
  ]);

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(first.json<SnapshotUpdatedEvent>().snapshot.revision, 1);
  assert.equal(duplicate.json<SnapshotUpdatedEvent>().snapshot.revision, 1);
  assert.equal(duplicate.json<SnapshotUpdatedEvent>().requestId, 'request-duplicate');

  const [second, third] = await Promise.all([
    server.inject({
      method: 'POST',
      url: '/v1/sessions/session-idempotent/observations',
      payload: observationPayload('session-idempotent', 'second', 3),
    }),
    server.inject({
      method: 'POST',
      url: '/v1/sessions/session-idempotent/observations',
      payload: observationPayload('session-idempotent', 'third', 4),
    }),
  ]);
  assert.equal(second.json<SnapshotUpdatedEvent>().snapshot.revision, 2);
  assert.equal(third.json<SnapshotUpdatedEvent>().snapshot.revision, 3);

  const stale = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-idempotent/observations',
    payload: observationPayload('session-idempotent', 'stale', 2),
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json<QaraaErrorEnvelope>().code, 'STALE_REVISION');
});

test('bounds reconnect snapshots at 256 and accepted observation IDs at 512', async () => {
  const store = new MemorySessionStore();
  const service = new SessionService({
    corpus,
    store,
    createSessionId: () => 'session-bounded',
  });
  await service.create({
    protocolVersion: 1,
    requestId: 'request-create',
    type: 'session.create',
    corpusId: corpus.corpusId,
  });

  for (let index = 0; index < 512; index += 1) {
    await service.submit(observationPayload(
      'session-bounded',
      `bounded-${index}`,
      index + 1,
    ));
  }
  const atCapacity = await store.get('session-bounded');
  assert.equal(atCapacity?.snapshot.revision, 512);
  assert.equal(atCapacity?.snapshots.length, 256);
  assert.equal(atCapacity?.snapshots[0]?.revision, 257);
  assert.equal(atCapacity?.observationIds.length, 512);

  const duplicate = await service.submit(observationPayload(
    'session-bounded',
    'bounded-0',
    513,
    'request-duplicate-at-capacity',
  ));
  assert.equal(duplicate.snapshot.revision, 512);

  await service.submit(observationPayload('session-bounded', 'bounded-512', 513));
  const evictedAccepted = await service.submit(observationPayload('session-bounded', 'bounded-0', 514));
  assert.equal(evictedAccepted.snapshot.revision, 514);

  const resumed = await service.resume({
    protocolVersion: 1,
    requestId: 'request-resume',
    type: 'session.resume',
    sessionId: 'session-bounded',
    lastSnapshotRevision: 510,
  });
  assert.deepEqual(resumed.map(({ snapshot }) => snapshot.revision), [511, 512, 513, 514]);
});

test('shares one immutable fixed-corpus index while keeping tracker state isolated per session', async () => {
  const indexedCorpora: unknown[] = [];
  let nextSession = 0;
  const service = new SessionService({
    corpus,
    createSessionId: () => `shared-index-${++nextSession}`,
    createTracker(options) {
      indexedCorpora.push(options.corpus);
      return createReadingTracker(options);
    },
  });
  const [first, second] = await Promise.all([
    service.create(createCommand('request-first')),
    service.create(createCommand('request-second')),
  ]);
  await service.submit(observationPayload(first.sessionId, 'first-only', 1));
  const secondSnapshot = await service.get({
    protocolVersion: 1,
    requestId: 'request-second-state',
    type: 'session.get',
    sessionId: second.sessionId,
  });

  assert.strictEqual(indexedCorpora[0], indexedCorpora[1]);
  assert.equal(secondSnapshot.snapshot.revision, 0);
});

test('preserves resolver-per-creation semantics instead of retaining resolved corpus results', async () => {
  let resolverCalls = 0;
  const indexedCorpora: unknown[] = [];
  const service = new SessionService({
    resolveCorpus(corpusId) {
      resolverCalls += 1;
      return {
        ...corpus,
        corpusId,
        revision: String(resolverCalls),
        symbols: [{
          ...corpus.symbols[0]!,
          phoneme: `resolved-${resolverCalls}`,
        }],
      };
    },
    createSessionId: () => `resolver-session-${resolverCalls + 1}`,
    createTracker(options) {
      indexedCorpora.push(options.corpus);
      return createReadingTracker(options);
    },
  });

  await service.create(createCommand('request-resolver-first'));
  await service.create(createCommand('request-resolver-second'));

  assert.equal(resolverCalls, 2);
  assert.notStrictEqual(indexedCorpora[0], indexedCorpora[1]);
});

test('enforces global session capacity, releases it on delete, and returns a typed safe failure', async (context) => {
  let nextSession = 0;
  const server = createQaraaServer({
    corpus,
    maxSessions: 1,
    createSessionId: () => `capacity-session-${++nextSession}`,
  });
  context.after(() => server.close());
  const first = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: createCommand('request-capacity-first'),
  });
  const rejected = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: createCommand('request-capacity-rejected'),
  });

  assert.equal(first.statusCode, 201);
  assert.equal(rejected.statusCode, 503);
  assert.deepEqual(rejected.json<QaraaErrorEnvelope>(), {
    protocolVersion: 1,
    requestId: 'request-capacity-rejected',
    type: 'error',
    code: 'INTERNAL_ERROR',
    message: 'Session capacity is exhausted',
    retryable: true,
    details: { kind: 'capacity', resource: 'sessions', limit: 1 },
  });

  await server.inject({
    method: 'DELETE',
    url: '/v1/sessions/capacity-session-1',
    headers: { 'x-request-id': 'request-capacity-delete' },
  });
  const afterDelete = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: createCommand('request-capacity-after-delete'),
  });
  assert.equal(afterDelete.statusCode, 201);
});

test('rolls back a pending session-capacity reservation after failed creation', async () => {
  const creationStarted = deferred();
  const releaseFailure = deferred();
  let createCalls = 0;
  const store: SessionStore = {
    async create(value) {
      createCalls += 1;
      if (createCalls === 1) {
        creationStarted.resolve();
        await releaseFailure.promise;
        throw new Error('expected create failure');
      }
      await backingStore.create(value);
    },
    get: (sessionId) => backingStore.get(sessionId),
    update: (sessionId, mutate) => backingStore.update(sessionId, mutate),
    delete: (sessionId) => backingStore.delete(sessionId),
  };
  const backingStore = new MemorySessionStore();
  let nextSession = 0;
  const service = new SessionService({
    corpus,
    store,
    maxSessions: 1,
    createSessionId: () => `rollback-session-${++nextSession}`,
  });

  const failing = service.create(createCommand('request-failing-create'));
  await creationStarted.promise;
  await assert.rejects(
    service.create(createCommand('request-during-reservation')),
    (error: unknown) => error instanceof QaraaProtocolError
      && error.code === 'INTERNAL_ERROR'
      && error.retryable,
  );
  releaseFailure.resolve();
  await assert.rejects(failing, /expected create failure/u);

  const recovered = await service.create(createCommand('request-after-rollback'));
  assert.equal(recovered.sessionId, 'rollback-session-3');
});

test('releases global subscriber capacity on unsubscribe and session delete', async () => {
  let nextSession = 0;
  const service = new SessionService({
    corpus,
    maxSubscribers: 1,
    createSessionId: () => `subscriber-session-${++nextSession}`,
  });
  const first = await service.create(createCommand('request-subscriber-first'));
  const second = await service.create(createCommand('request-subscriber-second'));
  const third = await service.create(createCommand('request-subscriber-third'));
  const commandFor = (sessionId: string, requestId: string) => ({
    protocolVersion: 1,
    requestId,
    type: 'session.resume' as const,
    sessionId,
    lastSnapshotRevision: 0,
  });

  const unsubscribeFirst = await service.subscribe(
    commandFor(first.sessionId, 'request-subscribe-first'),
    () => undefined,
  );
  await assert.rejects(
    service.subscribe(commandFor(second.sessionId, 'request-subscribe-rejected'), () => undefined),
    (error: unknown) => error instanceof QaraaProtocolError
      && error.code === 'INTERNAL_ERROR'
      && error.retryable,
  );
  unsubscribeFirst();
  await service.subscribe(commandFor(second.sessionId, 'request-subscribe-second'), () => undefined);
  await service.delete({
    protocolVersion: 1,
    requestId: 'request-delete-subscribed',
    type: 'session.delete',
    sessionId: second.sessionId,
  });
  const unsubscribeThird = await service.subscribe(
    commandFor(third.sessionId, 'request-subscribe-after-delete'),
    () => undefined,
  );
  unsubscribeThird();
});
