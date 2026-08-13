/**
 * Remote adapter transport, reconnect, and revision contract.
 *
 * @license Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ReadingSnapshot,
  RecitationObservation,
} from '@atqan/qaraa-core';
import { QaraaProtocolError } from '@atqan/qaraa-protocol';
import {
  createRemoteSession,
  type QaraaFetch,
  type QaraaWebSocket,
  type QaraaWebSocketCloseEvent,
  type QaraaWebSocketMessageEvent,
} from '../src/index.ts';

function observeCollectionsCreatedBy<T>(create: () => Promise<T>): Readonly<{
  result: Promise<T>;
  sets: Set<unknown>[];
  maps: Map<unknown, unknown>[];
}> {
  const sets: Set<unknown>[] = [];
  const maps: Map<unknown, unknown>[] = [];
  const NativeSet = Set;
  const NativeMap = Map;
  class ObservableSet<Value> extends NativeSet<Value> {
    constructor(values?: readonly Value[] | null) {
      super(values);
      sets.push(this as Set<unknown>);
    }
  }
  class ObservableMap<Key, Value> extends NativeMap<Key, Value> {
    constructor(entries?: readonly (readonly [Key, Value])[] | null) {
      super(entries);
      maps.push(this as Map<unknown, unknown>);
    }
  }

  let result!: Promise<T>;
  Reflect.set(globalThis, 'Set', ObservableSet);
  Reflect.set(globalThis, 'Map', ObservableMap);
  try {
    result = create();
  } finally {
    Reflect.set(globalThis, 'Set', NativeSet);
    Reflect.set(globalThis, 'Map', NativeMap);
  }
  return { result, sets, maps };
}

function snapshot(revision: number, observationId: string | null = null): ReadingSnapshot {
  const location = { surah: 1, ayah: 1, word: 1, symbol: 1 };
  return {
    revision,
    observationId,
    display: { location, isReread: false, activeWordId: null },
    commit: { location, completedWordIds: [] },
    confidence: null,
    finding: null,
  };
}

function updated(revision: number, observationId: string | null = null) {
  return {
    protocolVersion: 1,
    requestId: `event-${revision}`,
    type: 'snapshot.updated',
    sessionId: 'remote-session',
    snapshot: snapshot(revision, observationId),
  } as const;
}

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

type Listener = (event: never) => void;

class FakeWebSocket implements QaraaWebSocket {
  readonly url: string;
  readonly listeners = new Map<string, Set<Listener>>();
  readonly closes: Array<Readonly<{ code?: number; reason?: string }>> = [];

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
  }

  listenerCount(): number {
    return [...this.listeners.values()]
      .reduce((count, listeners) => count + listeners.size, 0);
  }

  emitMessage(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) } satisfies QaraaWebSocketMessageEvent);
  }

  emitClose(code: number): void {
    this.emit('close', { code, reason: '' } satisfies QaraaWebSocketCloseEvent);
  }

  private emit(type: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as never);
  }
}

function initialFetch(extra?: QaraaFetch): QaraaFetch {
  return async (url, init) => {
    if ((init?.method ?? 'GET') === 'GET') return response(updated(0));
    if (extra) return extra(url, init);
    throw new Error(`unexpected request: ${url}`);
  };
}

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}

const observation: RecitationObservation = {
  observationId: 'remote-observation-1',
  sourceRevision: 1,
  isFinal: true,
  receivedAtMs: 1,
  tokens: [{ id: 'remote-token-1', text: 'بِ', phonemes: ['bi'] }],
};

test('loads the remote snapshot, delivers immediately, and filters stale stream events twice', async () => {
  let socket: FakeWebSocket | undefined;
  const session = await createRemoteSession({
    baseUrl: 'https://qaraa.example/',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      socket = new FakeWebSocket(url);
      return socket;
    },
  });
  const revisions: number[] = [];
  session.subscribe((value) => revisions.push(value.revision));

  assert.equal(
    socket?.url,
    'wss://qaraa.example/v1/sessions/remote-session/stream?protocolVersion=1&lastSnapshotRevision=0',
  );
  socket?.emitMessage(updated(3));
  socket?.emitMessage(updated(2));
  await Promise.resolve();
  await Promise.resolve();
  socket?.emitMessage(updated(1));
  await Promise.resolve();

  assert.equal(session.getSnapshot().revision, 3);
  assert.deepEqual(revisions, [0, 3]);
});

test('retries only rejected transport calls with capped exponential backoff', async () => {
  let mutationAttempts = 0;
  const delays: number[] = [];
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async () => {
      mutationAttempts += 1;
      if (mutationAttempts < 4) throw new Error('temporary network failure');
      return response(updated(1, observation.observationId));
    }),
    createWebSocket: (url) => new FakeWebSocket(url),
    retry: {
      maxAttempts: 4,
      initialDelayMs: 10,
      maxDelayMs: 25,
      sleep: async (delayMs) => { delays.push(delayMs); },
    },
  });

  const result = await session.submit(observation);

  assert.equal(result.revision, 1);
  assert.equal(mutationAttempts, 4);
  assert.deepEqual(delays, [10, 20, 25]);
});

test('does not retry typed protocol failures even when the envelope says retryable', async () => {
  let mutationAttempts = 0;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async () => {
      mutationAttempts += 1;
      return response({
        protocolVersion: 1,
        requestId: 'typed-failure',
        type: 'error',
        code: 'INTERNAL_ERROR',
        message: 'Unavailable',
        retryable: true,
        details: {},
      }, 503);
    }),
    createWebSocket: (url) => new FakeWebSocket(url),
    retry: {
      maxAttempts: 4,
      initialDelayMs: 1,
      maxDelayMs: 2,
      sleep: async () => undefined,
    },
  });

  await assert.rejects(
    session.submit(observation),
    (error: unknown) => error instanceof QaraaProtocolError && error.code === 'INTERNAL_ERROR',
  );
  assert.equal(mutationAttempts, 1);
});

test('never resends an acknowledged observation ID', async () => {
  let mutationAttempts = 0;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async () => {
      mutationAttempts += 1;
      return response(updated(1, observation.observationId));
    }),
    createWebSocket: (url) => new FakeWebSocket(url),
  });

  const first = await session.submit(observation);
  const duplicate = await session.submit(observation);

  assert.equal(first.revision, 1);
  assert.equal(duplicate, first);
  assert.equal(mutationAttempts, 1);
});

test('reuses an acknowledged observation ID after a successful remote reset', async () => {
  const mutationTypes: string[] = [];
  let revision = 0;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async (_url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as { type?: string; observationId?: string };
      mutationTypes.push(body.type ?? 'unknown');
      revision += 1;
      return response(updated(revision, body.observationId ?? null));
    }),
    createWebSocket: (url) => new FakeWebSocket(url),
  });

  await session.submit(observation);
  await session.reset();
  const reused = await session.submit({ ...observation, sourceRevision: 0 });

  assert.deepEqual(mutationTypes, ['observation.submit', 'session.reset', 'observation.submit']);
  assert.equal(reused.observationId, observation.observationId);
  assert.equal(reused.revision, 3);
});

test('orders reset behind a delayed pre-reset response so its acknowledgement cannot poison reuse', async () => {
  const firstResponse = deferred();
  const mutationTypes: string[] = [];
  let submitCalls = 0;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async (_url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as { type?: string; observationId?: string };
      mutationTypes.push(body.type ?? 'unknown');
      if (body.type === 'observation.submit') {
        submitCalls += 1;
        if (submitCalls === 1) await firstResponse.promise;
        return response(updated(submitCalls === 1 ? 1 : 3, body.observationId ?? null));
      }
      return response(updated(2));
    }),
    createWebSocket: (url) => new FakeWebSocket(url),
  });

  const submitting = session.submit(observation);
  await waitUntil(() => mutationTypes.length === 1);
  const resetting = session.reset();
  await Promise.resolve();
  firstResponse.resolve();
  await submitting;
  await resetting;
  await session.submit({ ...observation, sourceRevision: 0 });

  assert.deepEqual(mutationTypes, ['observation.submit', 'session.reset', 'observation.submit']);
});

test('does not start a queued mutation after the remote session closes', async () => {
  const firstResponse = deferred();
  const observationIds: string[] = [];
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async (_url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as { observationId?: string };
      const observationId = body.observationId ?? 'unknown';
      observationIds.push(observationId);
      if (observationIds.length === 1) await firstResponse.promise;
      return response(updated(observationIds.length, observationId));
    }),
    createWebSocket: (url) => new FakeWebSocket(url),
  });

  const first = session.submit(observation);
  await waitUntil(() => observationIds.length === 1);
  const queued = session.submit({
    ...observation,
    observationId: 'queued-after-close',
    sourceRevision: 2,
  });
  await session.close();
  firstResponse.resolve();

  await first;
  await assert.rejects(queued, /session is closed/u);
  assert.deepEqual(observationIds, [observation.observationId]);
});

test('retains acknowledged observation IDs for the full remote session lifetime', async () => {
  let mutationAttempts = 0;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async (_url, init) => {
      mutationAttempts += 1;
      const body = JSON.parse(init?.body ?? '{}') as { observationId?: string };
      return response(updated(mutationAttempts, body.observationId ?? null));
    }),
    createWebSocket: (url) => new FakeWebSocket(url),
  });

  for (let index = 0; index < 513; index += 1) {
    await session.submit({
      ...observation,
      observationId: `retained-observation-${index}`,
      sourceRevision: index + 1,
    });
  }
  await session.submit({
    ...observation,
    observationId: 'retained-observation-0',
    sourceRevision: 1,
  });

  assert.equal(mutationAttempts, 513);
});

test('does not retry reset when its response may have been lost after mutation', async () => {
  let resetAttempts = 0;
  const delays: number[] = [];
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async () => {
      resetAttempts += 1;
      if (resetAttempts === 1) throw new Error('response lost');
      return response(updated(1));
    }),
    createWebSocket: (url) => new FakeWebSocket(url),
    retry: {
      maxAttempts: 3,
      initialDelayMs: 5,
      maxDelayMs: 20,
      sleep: async (delayMs) => { delays.push(delayMs); },
    },
  });

  await assert.rejects(session.reset(), /transport request failed/u);
  assert.equal(resetAttempts, 1);
  assert.deepEqual(delays, []);
});

test('reconnects retryable socket closes from the latest revision and stops on typed close codes', async () => {
  const sockets: FakeWebSocket[] = [];
  const delays: number[] = [];
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 5,
      maxDelayMs: 20,
      sleep: async (delayMs) => { delays.push(delayMs); },
    },
  });

  sockets[0]?.emitMessage(updated(2));
  await Promise.resolve();
  sockets[0]?.emitClose(1006);
  await waitUntil(() => sockets.length === 2);

  assert.deepEqual(delays, [5]);
  assert.equal(sockets.length, 2);
  assert.match(sockets[1]?.url ?? '', /lastSnapshotRevision=2$/u);

  sockets[1]?.emitClose(4404);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sockets.length, 2);
  await session.close();
});

test('caps consecutive WebSocket reconnect attempts and preserves exponential backoff', async () => {
  const sockets: FakeWebSocket[] = [];
  const delays: number[] = [];
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 2,
      maxDelayMs: 5,
      sleep: async (delayMs) => { delays.push(delayMs); },
    },
  });

  for (let index = 0; index < 3; index += 1) {
    const socketCount = sockets.length;
    sockets.at(-1)?.emitClose(1006);
    await waitUntil(() => sockets.length === socketCount + 1);
  }
  sockets.at(-1)?.emitClose(1006);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(delays, [2, 4, 5]);
  assert.equal(sockets.length, 4);
  await session.close();
});

test('isolates a throwing remote subscriber and keeps the revision queue live', async () => {
  let socket: FakeWebSocket | undefined;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      socket = new FakeWebSocket(url);
      return socket;
    },
  });
  const received: number[] = [];
  session.subscribe((value) => {
    if (value.revision > 0) throw new Error('listener failed');
  });
  session.subscribe((value) => received.push(value.revision));

  socket?.emitMessage(updated(1));
  socket?.emitMessage(updated(2));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(session.getSnapshot().revision, 2);
  assert.deepEqual(received, [0, 1, 2]);
});

test('rolls back a remote subscription when immediate delivery throws', async () => {
  let socket: FakeWebSocket | undefined;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      socket = new FakeWebSocket(url);
      return socket;
    },
  });
  let calls = 0;

  assert.throws(() => session.subscribe(() => {
    calls += 1;
    throw new Error('immediate listener failed');
  }), /immediate listener failed/u);
  socket?.emitMessage(updated(1));
  await Promise.resolve();

  assert.equal(calls, 1);
});

test('cancels an active reconnect wait when the remote session closes', async () => {
  const sockets: FakeWebSocket[] = [];
  let sleepStarted = false;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    retry: {
      maxAttempts: 3,
      initialDelayMs: 5,
      maxDelayMs: 20,
      sleep: async () => {
        sleepStarted = true;
        await new Promise<void>(() => undefined);
      },
    },
  });

  sockets[0]?.emitClose(1006);
  await waitUntil(() => sleepStarted);
  await session.close();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(sockets.length, 1);
});

test('skips a remote listener unsubscribed by an earlier publication listener', async () => {
  let socket: FakeWebSocket | undefined;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      socket = new FakeWebSocket(url);
      return socket;
    },
  });
  let unsubscribeLater = (): void => undefined;
  const laterRevisions: number[] = [];
  session.subscribe((value) => {
    if (value.revision > 0) unsubscribeLater();
  });
  unsubscribeLater = session.subscribe((value) => laterRevisions.push(value.revision));

  socket?.emitMessage(updated(1));
  await Promise.resolve();

  assert.deepEqual(laterRevisions, [0]);
  await session.close();
});

test('stops remote publication when an earlier listener closes the session', async () => {
  let socket: FakeWebSocket | undefined;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      socket = new FakeWebSocket(url);
      return socket;
    },
  });
  const laterRevisions: number[] = [];
  session.subscribe((value) => {
    if (value.revision > 0) void session.close();
  });
  session.subscribe((value) => laterRevisions.push(value.revision));

  socket?.emitMessage(updated(1));
  await Promise.resolve();
  await session.close();

  assert.equal(session.getSnapshot().revision, 1);
  assert.deepEqual(laterRevisions, [0]);
});

test('releases remote lifetime state and socket listeners before pending work settles', async () => {
  let socket: FakeWebSocket | undefined;
  let pendingStarted = false;
  let settlePending!: () => void;
  const pendingGate = new Promise<void>((resolve) => {
    settlePending = resolve;
  });
  const observed = observeCollectionsCreatedBy(() => createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(async (_url, init) => {
      const body = JSON.parse(init?.body ?? '{}') as { observationId?: string };
      if (body.observationId === 'pending-after-close') {
        pendingStarted = true;
        await pendingGate;
      }
      return response(updated(
        body.observationId === 'pending-after-close' ? 2 : 1,
        body.observationId ?? null,
      ));
    }),
    createWebSocket(url) {
      socket = new FakeWebSocket(url);
      return socket;
    },
  }));
  const session = await observed.result;
  await session.submit({ ...observation, observationId: 'ack-before-close' });
  const pending = session.submit({
    ...observation,
    observationId: 'pending-after-close',
    sourceRevision: 2,
  });
  await waitUntil(() => pendingStarted);
  session.subscribe(() => undefined);
  socket?.emitMessage(updated(3));

  const acknowledged = observed.sets.find((entries) => entries.has('ack-before-close'));
  const listeners = observed.sets.find((entries) =>
    [...entries].some((entry) => typeof entry === 'function'));
  const queuedNotifications = observed.sets.find((entries) =>
    [...entries].some((entry) => entry !== null && typeof entry === 'object'
      && 'snapshot' in entry));
  const submissions = observed.maps.find((entries) => entries.has('pending-after-close'));
  assert.ok(acknowledged, 'must observe the real acknowledgement set');
  assert.ok(submissions, 'must observe the real in-flight submission map');
  assert.ok(listeners, 'must observe the real listener set');
  assert.ok(queuedNotifications, 'must observe the real notification queue');
  assert.equal(acknowledged.size, 1);
  assert.equal(submissions.size, 1);
  assert.equal(listeners.size, 1);
  assert.equal(queuedNotifications.size, 1);
  assert.equal(socket?.listenerCount(), 3);

  await session.close();
  await session.close();
  assert.equal(acknowledged.size, 0);
  assert.equal(submissions.size, 0);
  assert.equal(listeners.size, 0);
  assert.equal(queuedNotifications.size, 0);
  assert.equal(socket?.listenerCount(), 0);
  assert.equal(socket?.closes.length, 1);

  settlePending();
  await pending;
  assert.equal(acknowledged.size, 0);
  assert.equal(submissions.size, 0);
});

test('unsubscribes and closes the active remote socket idempotently', async () => {
  let socket: FakeWebSocket | undefined;
  const session = await createRemoteSession({
    baseUrl: 'http://127.0.0.1:3000',
    sessionId: 'remote-session',
    fetch: initialFetch(),
    createWebSocket(url) {
      socket = new FakeWebSocket(url);
      return socket;
    },
  });
  const revisions: number[] = [];
  const unsubscribe = session.subscribe((value) => revisions.push(value.revision));

  unsubscribe();
  unsubscribe();
  socket?.emitMessage(updated(1));
  await Promise.resolve();
  await session.close();
  await session.close();

  assert.deepEqual(revisions, [0]);
  assert.equal(socket?.closes.length, 1);
  await assert.rejects(session.reset(), /session is closed/u);
});
