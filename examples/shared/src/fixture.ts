/** Shared, non-publishable example corpus and observation. @license Apache-2.0 */
import type { QuranCorpus, ReadingSnapshot, RecitationObservation } from '@atqan/qaraa-core';
import { createLocalSession, type QaraaSession } from '@atqan/qaraa-client';

export const exampleCorpus: QuranCorpus = {
  corpusId: 'example-corpus', revision: '1',
  symbols: [{ id: 's:1', text: 'ق', phoneme: 'q', location: { surah: 1, ayah: 1, word: 1, symbol: 1 } }],
  words: [{ id: 'w:1', text: 'ق', symbolIds: ['s:1'], location: { surah: 1, ayah: 1, word: 1 } }],
};
export const exampleObservation: RecitationObservation = {
  observationId: 'example-observation', sourceRevision: 1, isFinal: true, receivedAtMs: 1,
  tokens: [{ id: 't:1', text: 'ق', phonemes: ['q'], confidence: 1 }],
};
export const staleExampleObservation: RecitationObservation = {
  ...exampleObservation,
  observationId: 'stale-example-observation',
  sourceRevision: 0,
};

export type TrackedExampleSession = Readonly<{
  session: QaraaSession;
  stats: { subscriptions: number; unsubscriptions: number; closes: number };
}>;

/** Real local session with lifecycle counters used by every framework example gate. */
export function createTrackedExampleSession(): TrackedExampleSession {
  const inner = createLocalSession({ corpus: exampleCorpus });
  const stats = { subscriptions: 0, unsubscriptions: 0, closes: 0 };
  const session: QaraaSession = {
    getSnapshot: inner.getSnapshot,
    subscribe(listener) {
      stats.subscriptions += 1;
      const release = inner.subscribe(listener);
      let active = true;
      return () => { if (!active) return; active = false; stats.unsubscriptions += 1; release(); };
    },
    submit: inner.submit,
    reset: inner.reset,
    async close() { stats.closes += 1; await inner.close(); },
  };
  return { session, stats };
}

export async function exerciseExampleSession(session: QaraaSession): Promise<ReadingSnapshot> {
  const revisionOne = await session.submit(exampleObservation);
  const stale = await session.submit(staleExampleObservation);
  if (revisionOne.revision !== 1 || stale.revision !== 1) {
    throw new Error('example session did not reject stale revision zero');
  }
  return stale;
}
