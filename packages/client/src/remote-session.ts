/**
 * Remote REST and WebSocket QARAA session adapter.
 *
 * @license Apache-2.0
 */

import type {
  QuranLocation,
  ReadingSnapshot,
  RecitationObservation,
} from '@atqan/qaraa-core';
import {
  eventValidator,
  PROTOCOL_VERSION,
  QaraaProtocolError,
} from '@atqan/qaraa-protocol';
import type {
  QaraaErrorEnvelope,
  SnapshotUpdatedEvent,
} from '@atqan/qaraa-protocol';
import type {
  QaraaFetch,
  QaraaFetchInit,
  QaraaSession,
  QaraaWebSocket,
  QaraaWebSocketCloseEvent,
  QaraaWebSocketConstructor,
  QaraaWebSocketFactory,
  QaraaWebSocketMessageEvent,
  SnapshotListener,
} from './types.ts';

export type RemoteRetryOptions = Readonly<{
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => void | Promise<void>;
}>;

type RemoteSessionBaseOptions = Readonly<{
  baseUrl: string;
  sessionId: string;
  fetch: QaraaFetch;
  retry?: RemoteRetryOptions;
  createRequestId?: () => string;
}>;

export type RemoteSessionOptions = RemoteSessionBaseOptions & (
  | Readonly<{ createWebSocket: QaraaWebSocketFactory; WebSocket?: never }>
  | Readonly<{ WebSocket: QaraaWebSocketConstructor; createWebSocket?: never }>
);

type RetryPolicy = Readonly<{
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  sleep: (delayMs: number) => Promise<void>;
  delay: (delayMs: number) => CancelableDelay;
}>;

type CancelableDelay = Readonly<{
  promise: Promise<void>;
  cancel: () => void;
}>;

type QueuedNotification = Readonly<{ snapshot: ReadingSnapshot }>;

type InFlightSubmission = Readonly<{
  resetSequence: number;
  promise: Promise<ReadingSnapshot>;
}>;

/** Distinguishes failures to reach a transport from typed protocol failures. */
export class QaraaTransportError extends Error {
  readonly retryable: boolean;
  readonly cause: unknown;

  constructor(message: string, retryable: boolean, cause?: unknown) {
    super(message);
    this.name = 'QaraaTransportError';
    this.retryable = retryable;
    this.cause = cause;
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
}

function defaultDelay(delayMs: number): CancelableDelay {
  const schedule = Reflect.get(globalThis, 'setTimeout');
  const clear = Reflect.get(globalThis, 'clearTimeout');
  if (typeof schedule !== 'function') {
    return {
      promise: Promise.reject(new QaraaTransportError(
        'No timer implementation is available',
        false,
      )),
      cancel: () => undefined,
    };
  }

  let settled = false;
  let settle!: () => void;
  let timer: unknown;
  const promise = new Promise<void>((resolve) => {
    settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    timer = Reflect.apply(schedule, globalThis, [settle, delayMs]);
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      if (typeof clear === 'function') Reflect.apply(clear, globalThis, [timer]);
      settle();
    },
  };
}

function injectedDelay(
  sleep: (delayMs: number) => void | Promise<void>,
  delayMs: number,
): CancelableDelay {
  let cancel!: () => void;
  const cancelled = new Promise<void>((resolve) => {
    cancel = resolve;
  });
  return {
    promise: Promise.race([
      Promise.resolve().then(async () => { await sleep(delayMs); }),
      cancelled,
    ]),
    cancel,
  };
}

function retryPolicy(options: RemoteRetryOptions | undefined): RetryPolicy {
  const maxAttempts = options?.maxAttempts ?? 3;
  const initialDelayMs = options?.initialDelayMs ?? 100;
  const maxDelayMs = options?.maxDelayMs ?? 5_000;
  assertPositiveInteger(maxAttempts, 'maxAttempts');
  assertPositiveInteger(initialDelayMs, 'initialDelayMs');
  assertPositiveInteger(maxDelayMs, 'maxDelayMs');
  if (maxDelayMs < initialDelayMs) {
    throw new TypeError('maxDelayMs must be greater than or equal to initialDelayMs');
  }

  const delay = options?.sleep === undefined
    ? defaultDelay
    : (delayMs: number) => injectedDelay(options.sleep!, delayMs);

  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    sleep: async (delayMs) => { await delay(delayMs).promise; },
    delay,
  };
}

function retryDelay(policy: RetryPolicy, failedAttempt: number): number {
  return Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * (2 ** (failedAttempt - 1)),
  );
}

function transportFailure(error: unknown): QaraaTransportError {
  if (error instanceof QaraaTransportError) return error;
  return new QaraaTransportError('QARAA transport request failed', true, error);
}

function protocolFailure(envelope: QaraaErrorEnvelope): QaraaProtocolError {
  return new QaraaProtocolError(
    envelope.code,
    envelope.message,
    envelope.retryable,
    envelope.details,
  );
}

function normalizedBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, '');
  if (!/^https?:\/\//u.test(normalized)) {
    throw new TypeError('baseUrl must use http or https');
  }
  return normalized;
}

function websocketBaseUrl(baseUrl: string): string {
  return baseUrl.startsWith('https://')
    ? `wss://${baseUrl.slice('https://'.length)}`
    : `ws://${baseUrl.slice('http://'.length)}`;
}

function messageText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object' && 'toString' in value
    && typeof value.toString === 'function') {
    const text = value.toString();
    return text === '[object Object]' ? null : text;
  }
  return null;
}

function retryableSocketClose(event: QaraaWebSocketCloseEvent): boolean {
  return event.code !== 1000
    && event.code !== 1008
    && event.code !== 4404
    && event.code !== 4406;
}

/** Creates a remote session using only caller-provided network transports. */
export async function createRemoteSession(
  options: RemoteSessionOptions,
): Promise<QaraaSession> {
  const baseUrl = normalizedBaseUrl(options.baseUrl);
  const encodedSessionId = encodeURIComponent(options.sessionId);
  const sessionUrl = `${baseUrl}/v1/sessions/${encodedSessionId}`;
  const policy = retryPolicy(options.retry);
  let requestSequence = 0;
  const createRequestId = options.createRequestId ?? (() => {
    requestSequence += 1;
    return `qaraa-client-${requestSequence}`;
  });
  const webSocketFactory: QaraaWebSocketFactory = options.createWebSocket
    ?? ((url) => new options.WebSocket(url));

  let closed = false;
  let socket: QaraaWebSocket | undefined;
  let socketGeneration = 0;
  let reconnectAttempts = 0;
  let reconnectTask: Promise<void> | undefined;
  let cancelReconnectDelay: (() => void) | undefined;
  let socketDisposer: (() => void) | undefined;
  let notificationTail = Promise.resolve();
  let mutationTail = Promise.resolve();
  let scheduledResetSequence = 0;
  let pendingResetCount = 0;
  const acknowledged = new Set<string>();
  const submissions = new Map<string, InFlightSubmission>();
  const listeners = new Set<SnapshotListener>();
  const queuedNotifications = new Set<QueuedNotification>();

  const assertOpen = (): void => {
    if (closed) throw new Error('QARAA session is closed');
  };

  const request = async (
    url: string,
    init?: QaraaFetchInit,
    retryTransport = true,
  ): Promise<SnapshotUpdatedEvent> => {
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      let response;
      try {
        response = await options.fetch(url, init);
      } catch (error) {
        const failure = transportFailure(error);
        if (!retryTransport || !failure.retryable || attempt === policy.maxAttempts) throw failure;
        await policy.sleep(retryDelay(policy, attempt));
        assertOpen();
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new QaraaTransportError('QARAA transport returned invalid JSON', false, error);
      }
      if (!eventValidator(payload)) {
        throw new QaraaTransportError('QARAA transport returned an invalid event', false);
      }
      if (payload.type === 'error') throw protocolFailure(payload);
      if (!response.ok || payload.type !== 'snapshot.updated'
        || payload.sessionId !== options.sessionId) {
        throw new QaraaTransportError('QARAA transport returned an unexpected event', false);
      }
      return payload;
    }
    throw new QaraaTransportError('QARAA transport retry limit was exhausted', false);
  };

  let snapshot = (await request(sessionUrl, {
    method: 'GET',
    headers: { 'x-qaraa-protocol-version': String(PROTOCOL_VERSION) },
  })).snapshot;

  const notify = (next: ReadingSnapshot): ReadingSnapshot => {
    if (closed || next.revision <= snapshot.revision) return snapshot;
    snapshot = next;
    for (const listener of [...listeners]) {
      if (closed || !listeners.has(listener)) continue;
      try {
        listener(snapshot);
      } catch {
        listeners.delete(listener);
      }
    }
    return snapshot;
  };

  const enqueue = (next: ReadingSnapshot): void => {
    if (closed || next.revision <= snapshot.revision) return;
    const queued = { snapshot: next };
    queuedNotifications.add(queued);
    notificationTail = notificationTail.then(() => {
      if (!queuedNotifications.delete(queued)) return;
      if (closed || queued.snapshot.revision <= snapshot.revision) return;
      notify(queued.snapshot);
    });
  };

  const rememberAcknowledgment = (observationId: string): void => {
    acknowledged.add(observationId);
  };

  const enqueueMutation = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = mutationTail.then(() => {
      assertOpen();
      return operation();
    });
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  };

  const detachSocket = (
    target: QaraaWebSocket,
    messageListener: (event: unknown) => void,
    closeListener: (event: unknown) => void,
    openListener: (event: unknown) => void,
  ): void => {
    target.removeEventListener('message', messageListener);
    target.removeEventListener('close', closeListener);
    target.removeEventListener('open', openListener);
  };

  const scheduleReconnect = (): void => {
    if (closed || reconnectTask || socket || reconnectAttempts >= policy.maxAttempts) return;
    reconnectAttempts += 1;
    const attempt = reconnectAttempts;
    reconnectTask = (async () => {
      const delay = policy.delay(retryDelay(policy, attempt));
      cancelReconnectDelay = delay.cancel;
      try {
        await delay.promise;
      } catch {
        reconnectAttempts = policy.maxAttempts;
        return;
      } finally {
        if (cancelReconnectDelay === delay.cancel) cancelReconnectDelay = undefined;
      }
      if (closed || socket) return;
      try {
        openSocket();
      } catch (error) {
        const failure = transportFailure(error);
        if (!failure.retryable) reconnectAttempts = policy.maxAttempts;
      }
    })().finally(() => {
      reconnectTask = undefined;
      if (!closed && !socket && reconnectAttempts < policy.maxAttempts) {
        scheduleReconnect();
      }
    });
  };

  const openSocket = (): void => {
    assertOpen();
    const streamUrl = `${websocketBaseUrl(baseUrl)}/v1/sessions/${encodedSessionId}/stream`
      + `?protocolVersion=${PROTOCOL_VERSION}&lastSnapshotRevision=${snapshot.revision}`;
    const target = webSocketFactory(streamUrl);
    const generation = socketGeneration + 1;
    socketGeneration = generation;
    socket = target;

    const openListener = (): void => {
      if (!closed && generation === socketGeneration) reconnectAttempts = 0;
    };
    const messageListener = (event: unknown): void => {
      if (closed || generation !== socketGeneration || event === null || typeof event !== 'object'
        || !('data' in event)) return;
      const text = messageText((event as QaraaWebSocketMessageEvent).data);
      if (text === null) return;
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return;
      }
      if (!eventValidator(payload)) return;
      if (payload.type === 'snapshot.updated' && payload.sessionId === options.sessionId) {
        enqueue(payload.snapshot);
      }
    };
    function disposeSocketListeners(): void {
      detachSocket(target, messageListener, closeListener, openListener);
      if (socketDisposer === disposeSocketListeners) socketDisposer = undefined;
    }
    function closeListener(event: unknown): void {
      if (generation !== socketGeneration) return;
      disposeSocketListeners();
      socket = undefined;
      if (closed || event === null || typeof event !== 'object' || !('code' in event)) return;
      const closeEvent = event as QaraaWebSocketCloseEvent;
      if (retryableSocketClose(closeEvent)) scheduleReconnect();
    }
    socketDisposer = disposeSocketListeners;
    target.addEventListener('open', openListener);
    target.addEventListener('message', messageListener);
    target.addEventListener('close', closeListener);
  };

  try {
    openSocket();
  } catch (error) {
    const failure = transportFailure(error);
    if (!failure.retryable) throw failure;
    scheduleReconnect();
  }

  const session: QaraaSession = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      assertOpen();
      listeners.add(listener);
      try {
        listener(snapshot);
      } catch (error) {
        listeners.delete(listener);
        throw error;
      }
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    async submit(observation: RecitationObservation) {
      assertOpen();
      const resetSequence = scheduledResetSequence;
      if (pendingResetCount === 0 && acknowledged.has(observation.observationId)) return snapshot;
      const existing = submissions.get(observation.observationId);
      if (existing?.resetSequence === resetSequence) return existing.promise;

      const submitting = enqueueMutation(async () => {
        if (acknowledged.has(observation.observationId)) return snapshot;
        const result = await request(`${sessionUrl}/observations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            requestId: createRequestId(),
            type: 'observation.submit',
            sessionId: options.sessionId,
            observationId: observation.observationId,
            sourceRevision: observation.sourceRevision,
            isFinal: observation.isFinal,
            receivedAtMs: observation.receivedAtMs,
            tokens: observation.tokens,
          }),
        });
        if (!closed) rememberAcknowledgment(observation.observationId);
        return notify(result.snapshot);
      });
      const inFlight = Object.freeze({ resetSequence, promise: submitting });
      submissions.set(observation.observationId, inFlight);
      void submitting.finally(() => {
        if (submissions.get(observation.observationId) === inFlight) {
          submissions.delete(observation.observationId);
        }
      }).catch(() => undefined);
      return submitting;
    },
    async reset(location?: QuranLocation) {
      assertOpen();
      scheduledResetSequence += 1;
      pendingResetCount += 1;
      return enqueueMutation(async () => {
        const result = await request(`${sessionUrl}/reset`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            protocolVersion: PROTOCOL_VERSION,
            requestId: createRequestId(),
            type: 'session.reset',
            sessionId: options.sessionId,
            ...(location === undefined ? {} : { location }),
          }),
        }, false);
        acknowledged.clear();
        return notify(result.snapshot);
      }).finally(() => {
        pendingResetCount -= 1;
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      acknowledged.clear();
      submissions.clear();
      queuedNotifications.clear();
      notificationTail = Promise.resolve();
      mutationTail = Promise.resolve();
      cancelReconnectDelay?.();
      cancelReconnectDelay = undefined;
      reconnectTask = undefined;
      const activeSocket = socket;
      socketDisposer?.();
      socketDisposer = undefined;
      socket = undefined;
      socketGeneration += 1;
      activeSocket?.close(1000, 'QARAA session closed');
    },
  };
  return session;
}
