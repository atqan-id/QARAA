/**
 * WebSocket snapshot streaming and resume contract.
 *
 * @license Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { QuranCorpus } from '@atqan/qaraa-core';
import type {
  QaraaErrorEnvelope,
  SessionCreatedEvent,
  SnapshotUpdatedEvent,
} from '@atqan/qaraa-protocol';
import { createQaraaServer } from '../src/index.ts';

const corpus: QuranCorpus = {
  corpusId: 'websocket-corpus',
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

type Stream = Readonly<{
  socket: WebSocket;
  nextMessage(): Promise<unknown>;
  closed: Promise<Readonly<{ code: number; reason: string }>>;
}>;

async function openStream(url: string): Promise<Stream> {
  const socket = new WebSocket(url);
  const messages: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as unknown;
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else messages.push(message);
  });
  const closed = new Promise<Readonly<{ code: number; reason: string }>>((resolve) => {
    socket.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }));
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  return {
    socket,
    nextMessage: async () => messages.shift() ?? new Promise((resolve) => waiters.push(resolve)),
    closed,
  };
}

function observationPayload(sessionId: string, revision: number) {
  return {
    protocolVersion: 1,
    requestId: `request-observation-${revision}`,
    type: 'observation.submit',
    sessionId,
    observationId: `observation-${revision}`,
    sourceRevision: revision,
    isFinal: true,
    receivedAtMs: revision,
    tokens: [{ id: `token-${revision}`, text: 'بِ', phonemes: ['bi'] }],
  } as const;
}

test('streams observations and resumes with only snapshots newer than the acknowledged revision', async (context) => {
  const server = createQaraaServer({
    corpus,
    createSessionId: () => 'session-stream',
  });
  context.after(() => server.close());
  const createdResponse = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-create',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });
  const created = createdResponse.json<SessionCreatedEvent>();
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  const websocketAddress = address.replace(/^http/u, 'ws');

  const first = await openStream(
    `${websocketAddress}/v1/sessions/${created.sessionId}/stream`
      + '?protocolVersion=1&lastSnapshotRevision=0&requestId=stream-first',
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const submittedFirst = await server.inject({
    method: 'POST',
    url: `/v1/sessions/${created.sessionId}/observations`,
    payload: observationPayload(created.sessionId, 1),
  });
  assert.equal(submittedFirst.statusCode, 200);
  const firstEvent = await first.nextMessage() as SnapshotUpdatedEvent;
  assert.equal(firstEvent.type, 'snapshot.updated');
  assert.equal(firstEvent.snapshot.revision, 1);

  first.socket.close(1000, 'test disconnect');
  await first.closed;
  const submittedSecond = await server.inject({
    method: 'POST',
    url: `/v1/sessions/${created.sessionId}/observations`,
    payload: observationPayload(created.sessionId, 2),
  });
  assert.equal(submittedSecond.statusCode, 200);

  const resumed = await openStream(
    `${websocketAddress}/v1/sessions/${created.sessionId}/stream`
      + '?protocolVersion=1&lastSnapshotRevision=1&requestId=stream-resumed',
  );
  const resumedEvent = await resumed.nextMessage() as SnapshotUpdatedEvent;
  assert.equal(resumedEvent.snapshot.revision, 2);
  assert.equal(resumedEvent.requestId, 'stream-resumed');
  resumed.socket.close(1000, 'test complete');
  await resumed.closed;
});

test('sends a typed unsupported-protocol error before closing with 4406', async (context) => {
  const server = createQaraaServer({ corpus });
  context.after(() => server.close());
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  const websocketAddress = address.replace(/^http/u, 'ws');

  const stream = await openStream(
    `${websocketAddress}/v1/sessions/any-session/stream`
      + '?protocolVersion=2&lastSnapshotRevision=0&requestId=stream-version',
  );
  const error = await stream.nextMessage() as QaraaErrorEnvelope;
  const closed = await stream.closed;

  assert.equal(error.type, 'error');
  assert.equal(error.code, 'UNSUPPORTED_PROTOCOL');
  assert.equal(error.requestId, 'stream-version');
  assert.equal(closed.code, 4406);
});

test('sends a typed missing-session error before closing with 4404', async (context) => {
  const server = createQaraaServer({ corpus });
  context.after(() => server.close());
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  const websocketAddress = address.replace(/^http/u, 'ws');

  const stream = await openStream(
    `${websocketAddress}/v1/sessions/missing-session/stream`
      + '?protocolVersion=1&lastSnapshotRevision=0&requestId=stream-missing',
  );
  const error = await stream.nextMessage() as QaraaErrorEnvelope;
  const closed = await stream.closed;

  assert.equal(error.type, 'error');
  assert.equal(error.code, 'SESSION_NOT_FOUND');
  assert.equal(error.requestId, 'stream-missing');
  assert.equal(closed.code, 4404);
});

test('sends a typed retryable subscriber-capacity error and releases capacity on close', async (context) => {
  const server = createQaraaServer({
    corpus,
    maxSubscribers: 1,
    createSessionId: () => 'session-stream-capacity',
  });
  context.after(() => server.close());
  await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-create-capacity',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });
  const address = await server.listen({ port: 0, host: '127.0.0.1' });
  const websocketAddress = address.replace(/^http/u, 'ws');
  const streamUrl = `${websocketAddress}/v1/sessions/session-stream-capacity/stream`
    + '?protocolVersion=1&lastSnapshotRevision=0';
  const first = await openStream(`${streamUrl}&requestId=stream-capacity-first`);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const rejected = await openStream(`${streamUrl}&requestId=stream-capacity-rejected`);
  const error = await rejected.nextMessage() as QaraaErrorEnvelope;
  const closed = await rejected.closed;

  assert.equal(error.code, 'INTERNAL_ERROR');
  assert.equal(error.retryable, true);
  assert.deepEqual(error.details, { kind: 'capacity', resource: 'subscribers', limit: 1 });
  assert.equal(closed.code, 1013);

  first.socket.close(1000, 'release capacity');
  await first.closed;
  const afterClose = await openStream(`${streamUrl}&requestId=stream-capacity-after-close`);
  afterClose.socket.close(1000, 'complete');
  assert.equal((await afterClose.closed).code, 1000);
});
