/**
 * Strict non-DOM downstream contract for unified QARAA sessions.
 *
 * @license Apache-2.0
 */

import type {
  QuranCorpus,
  ReadingSnapshot,
  RecitationObservation,
} from '@atqan/qaraa-core';
import {
  createLocalSession,
  createRemoteSession,
  type QaraaFetch,
  type QaraaSession,
  type QaraaWebSocketFactory,
} from '@atqan/qaraa-client';

declare const corpus: QuranCorpus;
declare const observation: RecitationObservation;
declare const fetchTransport: QaraaFetch;
declare const createWebSocket: QaraaWebSocketFactory;

const local: QaraaSession = createLocalSession({ corpus });
const remote: QaraaSession = await createRemoteSession({
  baseUrl: 'https://qaraa.example',
  sessionId: 'consumer-session',
  fetch: fetchTransport,
  createWebSocket,
});
const snapshot: ReadingSnapshot = await local.submit(observation);
const unsubscribe: () => void = remote.subscribe(() => undefined);
unsubscribe();
void snapshot;
