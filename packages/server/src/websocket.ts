/**
 * Fastify WebSocket adapter for SessionService snapshot streams.
 *
 * @license Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import websocketPlugin from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PROTOCOL_VERSION } from '@atqan/qaraa-protocol';
import type { QaraaErrorEnvelope } from '@atqan/qaraa-protocol';
import type { SessionService } from './session-service.ts';
import { TrustedProtocolError } from './trusted-error.ts';

type StreamRequestParts = Readonly<{
  Params: Readonly<{ sessionId: string }>;
  Querystring: Readonly<{
    protocolVersion?: string;
    lastSnapshotRevision?: string;
    requestId?: string;
  }>;
}>;

type StreamSocket = Readonly<{
  send(payload: string, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  on(type: 'close', listener: () => void): void;
}>;

export interface QaraaStreamLogger {
  error(error: unknown): void | Promise<void>;
}

function requestId(request: FastifyRequest<StreamRequestParts>): string {
  const candidate = request.query.requestId;
  return typeof candidate === 'string' && /\S/u.test(candidate) ? candidate : randomUUID();
}

function negotiationError(): TrustedProtocolError {
  return new TrustedProtocolError(
    'UNSUPPORTED_PROTOCOL',
    'WebSocket protocol negotiation is invalid',
    false,
    { supportedProtocolVersion: PROTOCOL_VERSION },
  );
}

function internalError(): TrustedProtocolError {
  return new TrustedProtocolError(
    'INTERNAL_ERROR',
    'An internal error occurred',
    false,
    {},
  );
}

function logUnexpected(logger: QaraaStreamLogger, error: unknown): void {
  try {
    void Promise.resolve(logger.error(error)).catch(() => undefined);
  } catch {
    // Diagnostic sinks do not participate in transport safety.
  }
}

function sendErrorAndClose(
  socket: StreamSocket,
  envelope: QaraaErrorEnvelope,
  closeCode: number,
): void {
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    socket.close(closeCode, envelope.code);
  };
  try {
    socket.send(JSON.stringify(envelope), () => close());
  } catch {
    close();
  }
}

/** Registers the exact v1 streaming path on the shared Fastify server. */
export function registerQaraaWebSocket(
  server: FastifyInstance,
  service: SessionService,
  logger: QaraaStreamLogger,
): void {
  void server.register(async (streamServer) => {
    await streamServer.register(websocketPlugin);
    streamServer.get<StreamRequestParts>(
      '/v1/sessions/:sessionId/stream',
      { websocket: true },
      (socket, request) => {
        const streamSocket = socket as unknown as StreamSocket;
        let disconnected = false;
        let unsubscribe: (() => void) | undefined;
        streamSocket.on('close', () => {
          disconnected = true;
          unsubscribe?.();
        });

        const requestedVersion = request.query.protocolVersion === undefined
          ? PROTOCOL_VERSION
          : Number(request.query.protocolVersion);
        const lastSnapshotRevision = request.query.lastSnapshotRevision === undefined
          ? 0
          : Number(request.query.lastSnapshotRevision);
        const streamRequestId = requestId(request);
        if (requestedVersion !== PROTOCOL_VERSION
          || !Number.isSafeInteger(lastSnapshotRevision)
          || lastSnapshotRevision < 0) {
          const error = negotiationError();
          sendErrorAndClose(streamSocket, error.toEnvelope(streamRequestId), 4406);
          return;
        }

        void service.subscribe({
          protocolVersion: PROTOCOL_VERSION,
          requestId: streamRequestId,
          type: 'session.resume',
          sessionId: request.params.sessionId,
          lastSnapshotRevision,
        }, (event) => {
          if (!disconnected) streamSocket.send(JSON.stringify(event));
        }).then((stop) => {
          unsubscribe = stop;
          if (disconnected) unsubscribe();
        }).catch((error: unknown) => {
          if (disconnected) return;
          if (error instanceof TrustedProtocolError) {
            const closeCode = error.code === 'SESSION_NOT_FOUND'
              ? 4404
              : error.retryable
                ? 1013
                : 1008;
            sendErrorAndClose(streamSocket, error.toEnvelope(streamRequestId), closeCode);
          } else {
            logUnexpected(logger, error);
            sendErrorAndClose(streamSocket, internalError().toEnvelope(streamRequestId), 1011);
          }
        });
      },
    );
  });
}
