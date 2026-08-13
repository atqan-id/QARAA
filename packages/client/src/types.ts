/**
 * Adapter-facing QARAA session and structural transport contracts.
 *
 * @license Apache-2.0
 */

import type {
  QuranLocation,
  ReadingSnapshot,
  RecitationObservation,
} from '@atqan/qaraa-core';

export type SnapshotListener = (snapshot: ReadingSnapshot) => void;

/** One lifecycle shared by local and remote JavaScript consumers. */
export interface QaraaSession {
  getSnapshot(): ReadingSnapshot;
  subscribe(listener: SnapshotListener): () => void;
  submit(observation: RecitationObservation): Promise<ReadingSnapshot>;
  reset(location?: QuranLocation): Promise<ReadingSnapshot>;
  close(): Promise<void>;
}

export type QaraaFetchInit = Readonly<{
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
}>;

export interface QaraaFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): unknown | Promise<unknown>;
}

/** Fetch-compatible function without a dependency on DOM declarations. */
export type QaraaFetch = (
  url: string,
  init?: QaraaFetchInit,
) => Promise<QaraaFetchResponse>;

export type QaraaWebSocketMessageEvent = Readonly<{ data: unknown }>;
export type QaraaWebSocketCloseEvent = Readonly<{ code: number; reason: string }>;
export type QaraaWebSocketListener = (event: unknown) => void;

/** WebSocket-compatible object without a dependency on DOM declarations. */
export interface QaraaWebSocket {
  addEventListener(type: string, listener: QaraaWebSocketListener): void;
  removeEventListener(type: string, listener: QaraaWebSocketListener): void;
  close(code?: number, reason?: string): void;
}

export type QaraaWebSocketFactory = (url: string) => QaraaWebSocket;

export interface QaraaWebSocketConstructor {
  new(url: string): QaraaWebSocket;
}
