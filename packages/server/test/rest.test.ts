/**
 * REST lifecycle contract for embeddable in-memory sessions.
 *
 * @license Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadingTracker } from '@atqan/qaraa-core';
import type { QuranCorpus } from '@atqan/qaraa-core';
import type {
  QaraaErrorEnvelope,
  SessionCreatedEvent,
  SessionDeletedEvent,
  SnapshotUpdatedEvent,
} from '@atqan/qaraa-protocol';
import { createQaraaServer } from '../src/index.ts';

const corpus: QuranCorpus = {
  corpusId: 'rest-corpus',
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

test('creates, gets, resets, and deletes a session without binding a port', async (context) => {
  const server = createQaraaServer({
    corpus,
    createSessionId: () => 'session-rest-1',
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
  assert.equal(createdResponse.statusCode, 201);
  const created = createdResponse.json<SessionCreatedEvent>();
  assert.equal(created.type, 'session.created');
  assert.equal(created.requestId, 'request-create');
  assert.equal(created.sessionId, 'session-rest-1');
  assert.equal(created.snapshot.revision, 0);

  const getResponse = await server.inject({
    method: 'GET',
    url: '/v1/sessions/session-rest-1',
    headers: { 'x-request-id': 'request-get' },
  });
  assert.equal(getResponse.statusCode, 200);
  const got = getResponse.json<SnapshotUpdatedEvent>();
  assert.equal(got.type, 'snapshot.updated');
  assert.equal(got.requestId, 'request-get');
  assert.deepEqual(got.snapshot, created.snapshot);

  const resetResponse = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-rest-1/reset',
    payload: {
      protocolVersion: 1,
      requestId: 'request-reset',
      type: 'session.reset',
      sessionId: 'session-rest-1',
    },
  });
  assert.equal(resetResponse.statusCode, 200);
  const reset = resetResponse.json<SnapshotUpdatedEvent>();
  assert.equal(reset.type, 'snapshot.updated');
  assert.equal(reset.snapshot.revision, 1);
  assert.equal(reset.snapshot.observationId, null);

  const deleteResponse = await server.inject({
    method: 'DELETE',
    url: '/v1/sessions/session-rest-1',
    headers: { 'x-request-id': 'request-delete' },
  });
  assert.equal(deleteResponse.statusCode, 200);
  assert.deepEqual(deleteResponse.json<SessionDeletedEvent>(), {
    protocolVersion: 1,
    requestId: 'request-delete',
    type: 'session.deleted',
    sessionId: 'session-rest-1',
  });

  const missingResponse = await server.inject({
    method: 'GET',
    url: '/v1/sessions/session-rest-1',
    headers: { 'x-request-id': 'request-missing' },
  });
  assert.equal(missingResponse.statusCode, 404);
  const missing = missingResponse.json<QaraaErrorEnvelope>();
  assert.equal(missing.code, 'SESSION_NOT_FOUND');
  assert.equal(missing.requestId, 'request-missing');
});

test('resolves a corpus by identifier without accepting it in the request', async (context) => {
  const requestedCorpusIds: string[] = [];
  const server = createQaraaServer({
    resolveCorpus(corpusId) {
      requestedCorpusIds.push(corpusId);
      return corpusId === corpus.corpusId ? corpus : null;
    },
    createSessionId: () => 'session-resolved',
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-resolve',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(requestedCorpusIds, [corpus.corpusId]);
});

test('rejects request-supplied corpus artifacts before invoking the resolver', async (context) => {
  let resolverCalls = 0;
  const server = createQaraaServer({
    resolveCorpus() {
      resolverCalls += 1;
      return corpus;
    },
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-artifact',
      type: 'session.create',
      corpusId: corpus.corpusId,
      corpus,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json<QaraaErrorEnvelope>().code, 'INVALID_CORPUS');
  assert.equal(resolverCalls, 0);
});

test('preserves typed validation and protocol errors without logging them', async (context) => {
  const logged: unknown[] = [];
  const server = createQaraaServer({
    corpus,
    logger: { error: (error) => logged.push(error) },
    createSessionId: () => 'session-validation',
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

  const invalidObservation = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-validation/observations',
    payload: {
      ...{
        protocolVersion: 1,
        requestId: 'request-invalid-observation',
        type: 'observation.submit',
        sessionId: 'session-validation',
        observationId: 'invalid-observation',
        sourceRevision: -1,
        isFinal: false,
        receivedAtMs: 0,
        tokens: [],
      },
    },
  });
  assert.equal(invalidObservation.statusCode, 400);
  assert.equal(invalidObservation.json<QaraaErrorEnvelope>().code, 'INVALID_OBSERVATION');

  const unsupported = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 2,
      requestId: 'request-unsupported',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });
  assert.equal(unsupported.statusCode, 400);
  assert.equal(unsupported.json<QaraaErrorEnvelope>().code, 'UNSUPPORTED_PROTOCOL');
  assert.deepEqual(logged, []);
});

test('logs unexpected failures and exposes only a safe internal error', async (context) => {
  const failure = new Error('private resolver endpoint and credential');
  const logged: unknown[] = [];
  const server = createQaraaServer({
    resolveCorpus() {
      throw failure;
    },
    logger: { error: (error) => logged.push(error) },
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-internal',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json<QaraaErrorEnvelope>(), {
    protocolVersion: 1,
    requestId: 'request-internal',
    type: 'error',
    code: 'INTERNAL_ERROR',
    message: 'An internal error occurred',
    retryable: false,
    details: {},
  });
  assert.deepEqual(logged, [failure]);
  assert.doesNotMatch(response.body, /private|credential|endpoint/u);
});

test('replays only cached snapshots newer than the requested revision', async (context) => {
  const server = createQaraaServer({
    corpus,
    createSessionId: () => 'session-resume',
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
  for (let sourceRevision = 1; sourceRevision <= 3; sourceRevision += 1) {
    await server.inject({
      method: 'POST',
      url: '/v1/sessions/session-resume/observations',
      payload: {
        protocolVersion: 1,
        requestId: `request-observation-${sourceRevision}`,
        type: 'observation.submit',
        sessionId: 'session-resume',
        observationId: `observation-${sourceRevision}`,
        sourceRevision,
        isFinal: true,
        receivedAtMs: sourceRevision,
        tokens: [{ id: `token-${sourceRevision}`, text: 'بِ', phonemes: ['bi'] }],
      },
    });
  }

  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-resume/resume',
    payload: {
      protocolVersion: 1,
      requestId: 'request-resume',
      type: 'session.resume',
      sessionId: 'session-resume',
      lastSnapshotRevision: 1,
    },
  });

  assert.equal(response.statusCode, 200);
  const events = response.json<SnapshotUpdatedEvent[]>();
  assert.deepEqual(events.map(({ snapshot }) => snapshot.revision), [2, 3]);
  assert.ok(events.every(({ requestId }) => requestId === 'request-resume'));
});

test('sanitizes a typed-looking error thrown by an injected resolver', async (context) => {
  const { QaraaProtocolError } = await import('@atqan/qaraa-protocol');
  const failure = new QaraaProtocolError(
    'INVALID_CORPUS',
    'private resolver credential',
    false,
    { endpoint: 'private-endpoint' },
  );
  const logged: unknown[] = [];
  const server = createQaraaServer({
    resolveCorpus() {
      throw failure;
    },
    logger: { error: (error) => logged.push(error) },
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-hostile-resolver',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json<QaraaErrorEnvelope>().code, 'INTERNAL_ERROR');
  assert.deepEqual(logged, [failure]);
  assert.doesNotMatch(response.body, /private|credential|endpoint/u);
});

test('maps malformed JSON and unknown routes to safe protocol envelopes', async (context) => {
  const logged: unknown[] = [];
  const server = createQaraaServer({
    corpus,
    logger: { error: (error) => logged.push(error) },
  });
  context.after(() => server.close());

  const malformed = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'request-malformed',
    },
    payload: '{',
  });
  assert.equal(malformed.statusCode, 400);
  assert.deepEqual(malformed.json<QaraaErrorEnvelope>(), {
    protocolVersion: 1,
    requestId: 'request-malformed',
    type: 'error',
    code: 'INVALID_CORPUS',
    message: 'Request body is not valid JSON',
    retryable: false,
    details: {},
  });

  const malformedObservation = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-malformed/observations',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'request-malformed-observation',
    },
    payload: '{',
  });
  assert.equal(malformedObservation.statusCode, 400);
  assert.equal(
    malformedObservation.json<QaraaErrorEnvelope>().code,
    'INVALID_OBSERVATION',
  );

  const malformedReset = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-malformed/reset',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'request-malformed-reset',
    },
    payload: '{',
  });
  assert.equal(malformedReset.statusCode, 400);
  assert.equal(malformedReset.json<QaraaErrorEnvelope>().code, 'INVALID_CORPUS');

  const missingRoute = await server.inject({
    method: 'GET',
    url: '/not-a-qaraa-route',
    headers: { 'x-request-id': 'request-route-missing' },
  });
  assert.equal(missingRoute.statusCode, 404);
  assert.equal(missingRoute.json<QaraaErrorEnvelope>().code, 'SESSION_NOT_FOUND');
  assert.equal(missingRoute.json<QaraaErrorEnvelope>().requestId, 'request-route-missing');
  assert.deepEqual(logged, []);
});

test('maps duplicate corpus IDs from core validation to INVALID_CORPUS', async (context) => {
  const duplicateCorpus: QuranCorpus = {
    ...corpus,
    corpusId: 'duplicate-corpus',
    symbols: [
      corpus.symbols[0]!,
      {
        ...corpus.symbols[0]!,
        location: { surah: 1, ayah: 1, word: 2, symbol: 1 },
      },
    ],
  };
  const logged: unknown[] = [];
  const server = createQaraaServer({
    resolveCorpus: (corpusId) => (
      corpusId === duplicateCorpus.corpusId ? duplicateCorpus : null
    ),
    logger: { error: (error) => logged.push(error) },
  });
  context.after(() => server.close());

  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-duplicate-corpus',
      type: 'session.create',
      corpusId: duplicateCorpus.corpusId,
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json<QaraaErrorEnvelope>().code, 'INVALID_CORPUS');
  assert.deepEqual(logged, []);
});

test('maps duplicate token IDs to INVALID_OBSERVATION before tracker mutation', async (context) => {
  const server = createQaraaServer({
    corpus,
    createSessionId: () => 'session-duplicate-token',
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

  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-duplicate-token/observations',
    payload: {
      protocolVersion: 1,
      requestId: 'request-duplicate-token',
      type: 'observation.submit',
      sessionId: 'session-duplicate-token',
      observationId: 'observation-duplicate-token',
      sourceRevision: 1,
      isFinal: true,
      receivedAtMs: 1,
      tokens: [
        { id: 'duplicate-token', text: 'بِ', phonemes: ['bi'] },
        { id: 'duplicate-token', text: 'بِ', phonemes: ['bi'] },
      ],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json<QaraaErrorEnvelope>().code, 'INVALID_OBSERVATION');
  const current = await server.inject({
    method: 'GET',
    url: '/v1/sessions/session-duplicate-token',
    headers: { 'x-request-id': 'request-current' },
  });
  assert.equal(current.json<SnapshotUpdatedEvent>().snapshot.revision, 0);
});

test('rejects an oversized observation command before tracker candidate work', async (context) => {
  let candidateEvaluations = 0;
  const server = createQaraaServer({
    corpus,
    createSessionId: () => 'session-observation-limit',
    createTracker(options) {
      return createReadingTracker({
        ...options,
        metricsSink: {
          recordCandidateEvaluation() {
            candidateEvaluations += 1;
          },
          recordEditCell() {},
          recordCorpusSymbolAccess() {},
        },
      });
    },
  });
  context.after(() => server.close());
  await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-create-limit',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });

  const boundary = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-observation-limit/observations',
    payload: {
      protocolVersion: 1,
      requestId: 'request-observation-boundary',
      type: 'observation.submit',
      sessionId: 'session-observation-limit',
      observationId: 'boundary-observation',
      sourceRevision: 1,
      isFinal: true,
      receivedAtMs: 1,
      tokens: [{
        id: 'boundary-token',
        text: 'boundary',
        phonemes: Array.from({ length: 128 }, () => 'p'),
      }],
    },
  });
  assert.equal(boundary.statusCode, 200);
  assert.ok(candidateEvaluations > 0);
  candidateEvaluations = 0;

  const rejected = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-observation-limit/observations',
    payload: {
      protocolVersion: 1,
      requestId: 'request-observation-limit',
      type: 'observation.submit',
      sessionId: 'session-observation-limit',
      observationId: 'oversized-observation',
      sourceRevision: 2,
      isFinal: true,
      receivedAtMs: 1,
      tokens: [{
        id: 'oversized-token',
        text: 'oversized',
        phonemes: Array.from({ length: 129 }, () => 'p'),
      }],
    },
  });
  const current = await server.inject({
    method: 'GET',
    url: '/v1/sessions/session-observation-limit',
    headers: { 'x-request-id': 'request-after-limit' },
  });

  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json<QaraaErrorEnvelope>().code, 'INVALID_OBSERVATION');
  assert.equal(candidateEvaluations, 0);
  assert.equal(current.json<SnapshotUpdatedEvent>().snapshot.revision, 1);
});

test('rejects out-of-corpus create and reset locations before mutation', async (context) => {
  const server = createQaraaServer({
    corpus,
    createSessionId: () => 'session-location',
  });
  context.after(() => server.close());
  const missingLocation = { surah: 2, ayah: 1, word: 1, symbol: 1 };

  const invalidCreate = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-invalid-create-location',
      type: 'session.create',
      corpusId: corpus.corpusId,
      initialLocation: missingLocation,
    },
  });
  assert.equal(invalidCreate.statusCode, 400);
  assert.equal(invalidCreate.json<QaraaErrorEnvelope>().code, 'INVALID_CORPUS');

  const created = await server.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-valid-create',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });
  const sessionId = created.json<SessionCreatedEvent>().sessionId;
  const invalidReset = await server.inject({
    method: 'POST',
    url: `/v1/sessions/${sessionId}/reset`,
    payload: {
      protocolVersion: 1,
      requestId: 'request-invalid-reset-location',
      type: 'session.reset',
      sessionId,
      location: missingLocation,
    },
  });
  assert.equal(invalidReset.statusCode, 400);
  assert.equal(invalidReset.json<QaraaErrorEnvelope>().code, 'INVALID_CORPUS');

  const submitted = await server.inject({
    method: 'POST',
    url: `/v1/sessions/${sessionId}/observations`,
    payload: {
      protocolVersion: 1,
      requestId: 'request-after-invalid-reset',
      type: 'observation.submit',
      sessionId,
      observationId: 'observation-after-invalid-reset',
      sourceRevision: 1,
      isFinal: true,
      receivedAtMs: 1,
      tokens: [{ id: 'token-after-invalid-reset', text: 'بِ', phonemes: ['bi'] }],
    },
  });
  assert.equal(submitted.statusCode, 200);
  assert.equal(submitted.json<SnapshotUpdatedEvent>().snapshot.revision, 1);
});

test('keeps unexpected tracker faults behind INTERNAL_ERROR', async (context) => {
  const failure = new Error('private tracker implementation detail');
  const logged: unknown[] = [];
  const server = createQaraaServer({
    corpus,
    createSessionId: () => 'session-tracker-fault',
    createTracker(options) {
      const tracker = createReadingTracker(options);
      return {
        getSnapshot: () => tracker.getSnapshot(),
        reset: (location) => tracker.reset(location),
        submit: () => {
          throw failure;
        },
      };
    },
    logger: { error: (error) => logged.push(error) },
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

  const response = await server.inject({
    method: 'POST',
    url: '/v1/sessions/session-tracker-fault/observations',
    payload: {
      protocolVersion: 1,
      requestId: 'request-tracker-fault',
      type: 'observation.submit',
      sessionId: 'session-tracker-fault',
      observationId: 'observation-tracker-fault',
      sourceRevision: 1,
      isFinal: true,
      receivedAtMs: 1,
      tokens: [{ id: 'token-tracker-fault', text: 'بِ', phonemes: ['bi'] }],
    },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json<QaraaErrorEnvelope>().code, 'INTERNAL_ERROR');
  assert.deepEqual(logged, [failure]);
  assert.doesNotMatch(response.body, /private tracker implementation detail/u);
});

test('isolates synchronous and asynchronous logger failures from responses', async (context) => {
  const unexpected = new Error('unexpected resolver failure');
  const synchronousLoggerFailure = new Error('synchronous logger failure');
  const syncServer = createQaraaServer({
    resolveCorpus() {
      throw unexpected;
    },
    logger: {
      error() {
        throw synchronousLoggerFailure;
      },
    },
  });
  context.after(() => syncServer.close());
  const syncResponse = await syncServer.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-sync-logger',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });
  assert.equal(syncResponse.statusCode, 500);
  assert.equal(syncResponse.json<QaraaErrorEnvelope>().code, 'INTERNAL_ERROR');

  const asynchronousLoggerFailure = new Error('asynchronous logger failure');
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (error: unknown) => {
    unhandledRejections.push(error);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  context.after(() => process.off('unhandledRejection', onUnhandledRejection));
  const asyncServer = createQaraaServer({
    resolveCorpus() {
      throw unexpected;
    },
    logger: {
      async error() {
        throw asynchronousLoggerFailure;
      },
    },
  });
  context.after(() => asyncServer.close());
  const asyncResponse = await asyncServer.inject({
    method: 'POST',
    url: '/v1/sessions',
    payload: {
      protocolVersion: 1,
      requestId: 'request-async-logger',
      type: 'session.create',
      corpusId: corpus.corpusId,
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(asyncResponse.statusCode, 500);
  assert.equal(asyncResponse.json<QaraaErrorEnvelope>().code, 'INTERNAL_ERROR');
  assert.deepEqual(unhandledRejections, []);
});
