/**
 * In-process QARAA session adapter.
 *
 * @license Apache-2.0
 */

import { createReadingTracker, indexCorpus } from '@atqan/qaraa-core';
import type {
  FindingMode,
  QuranCorpus,
  QuranLocation,
  ReadingSnapshot,
  RecitationObservation,
} from '@atqan/qaraa-core';
import type { QaraaSession, SnapshotListener } from './types.ts';

export type LocalSessionOptions = Readonly<{
  corpus: QuranCorpus;
  initialLocation?: QuranLocation;
  findingMode?: FindingMode;
}>;

/** Creates a synchronous core tracker behind the asynchronous session lifecycle. */
export function createLocalSession(options: LocalSessionOptions): QaraaSession {
  const tracker = createReadingTracker({
    corpus: indexCorpus(options.corpus),
    ...(options.initialLocation === undefined ? {} : { initialLocation: options.initialLocation }),
    ...(options.findingMode === undefined ? {} : { findingMode: options.findingMode }),
  });
  const listeners = new Set<SnapshotListener>();
  let snapshot = tracker.getSnapshot();
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error('QARAA session is closed');
  };
  const publish = (next: ReadingSnapshot): ReadingSnapshot => {
    if (next.revision <= snapshot.revision) return snapshot;
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

  return {
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
      return publish(tracker.submit(observation));
    },
    async reset(location?: QuranLocation) {
      assertOpen();
      return publish(tracker.reset(location));
    },
    async close() {
      if (closed) return;
      closed = true;
      listeners.clear();
    },
  };
}
