/**
 * Unified local and remote QARAA JavaScript sessions.
 *
 * @license Apache-2.0
 */

export { createLocalSession } from './local-session.ts';
export type { LocalSessionOptions } from './local-session.ts';
export { createRemoteSession, QaraaTransportError } from './remote-session.ts';
export { createAdapterController } from './adapter-controller.ts';
export type {
  QaraaAdapterController,
  QaraaState,
  QaraaStateListener,
  QaraaStatus,
} from './adapter-controller.ts';
export type {
  RemoteRetryOptions,
  RemoteSessionOptions,
} from './remote-session.ts';
export type {
  QaraaFetch,
  QaraaFetchInit,
  QaraaFetchResponse,
  QaraaSession,
  QaraaWebSocket,
  QaraaWebSocketCloseEvent,
  QaraaWebSocketConstructor,
  QaraaWebSocketFactory,
  QaraaWebSocketListener,
  QaraaWebSocketMessageEvent,
  SnapshotListener,
} from './types.ts';
