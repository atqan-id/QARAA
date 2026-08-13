/**
 * Framework-neutral reactive lifecycle boundary for QARAA adapters.
 *
 * @license Apache-2.0
 */

import type {
  QuranLocation,
  ReadingSnapshot,
  RecitationObservation,
} from '@atqan/qaraa-core';
import type { QaraaSession } from './types.ts';

export type QaraaStatus = 'idle' | 'ready' | 'submitting' | 'closed';
export type QaraaState = Readonly<{
  snapshot: ReadingSnapshot;
  status: QaraaStatus;
  error: Error | null;
}>;
export type QaraaStateListener = () => void;

export interface QaraaAdapterController {
  read(): QaraaState;
  subscribe(listener: QaraaStateListener): () => void;
  connect(): void;
  dispose(): Promise<void>;
  submit(observation: RecitationObservation): Promise<ReadingSnapshot>;
  reset(location?: QuranLocation): Promise<ReadingSnapshot>;
  close(): Promise<void>;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Owns its subscription, never implicit session lifetime. Explicit `close` is
 * idempotent and remains safe when passed as an unbound framework action.
 */
export function createAdapterController(session: QaraaSession): QaraaAdapterController {
  let state: QaraaState = Object.freeze({
    snapshot: session.getSnapshot(),
    status: 'idle',
    error: null,
  });
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  let lifecycleRevision = 0;
  let closePromise: Promise<void> | undefined;
  const listeners = new Set<QaraaStateListener>();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        listeners.delete(listener);
      }
    }
  };
  const setState = (next: QaraaState): void => {
    state = Object.freeze(next);
    notify();
  };
  const acceptSnapshot = (next: ReadingSnapshot): void => {
    if (next.revision <= state.snapshot.revision) return;
    const acceptedAt = lifecycleRevision;
    void Promise.resolve().then(() => {
      if (
        closed
        || acceptedAt !== lifecycleRevision
        || next.revision <= state.snapshot.revision
      ) return;
      setState({ ...state, snapshot: next, status: 'ready' });
    });
  };
  const connect = (): void => {
    if (closed || unsubscribe) return;
    unsubscribe = session.subscribe(acceptSnapshot);
    setState({ ...state, status: 'ready' });
  };
  const dispose = async (): Promise<void> => {
    lifecycleRevision += 1;
    const release = unsubscribe;
    unsubscribe = undefined;
    release?.();
  };
  const action = async <Result>(run: () => Promise<Result>): Promise<Result> => {
    if (closed) throw new Error('QARAA session is closed');
    setState({ ...state, status: 'submitting', error: null });
    try {
      const result = await run();
      if (!closed) setState({ ...state, status: 'ready', error: null });
      return result;
    } catch (error) {
      const normalized = asError(error);
      if (!closed) setState({ ...state, status: 'ready', error: normalized });
      throw normalized;
    }
  };
  const submit = (observation: RecitationObservation): Promise<ReadingSnapshot> => (
    action(() => session.submit(observation))
  );
  const reset = (location?: QuranLocation): Promise<ReadingSnapshot> => (
    action(() => session.reset(location))
  );
  const close = (): Promise<void> => {
    if (!closePromise) {
      closePromise = (async () => {
        closed = true;
        await dispose();
        try {
          await session.close();
        } finally {
          setState({ ...state, status: 'closed' });
          listeners.clear();
        }
      })();
    }
    return closePromise;
  };

  return {
    read: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connect,
    dispose,
    submit,
    reset,
    close,
  };
}
