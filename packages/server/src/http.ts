/**
 * Fastify REST adapter for the in-memory QARAA session service.
 *
 * @license Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  assertValidCommand,
  commandValidator,
  PROTOCOL_VERSION,
  QaraaProtocolError,
} from '@atqan/qaraa-protocol';
import type {
  ObservationSubmitCommand,
  QaraaCommand,
  QaraaErrorEnvelope,
  SessionCreateCommand,
  SessionDeleteCommand,
  SessionGetCommand,
  SessionResetCommand,
  SessionResumeCommand,
} from '@atqan/qaraa-protocol';
import { SessionService } from './session-service.ts';
import type { SessionServiceOptions } from './session-service.ts';
import { TrustedProtocolError, trustProtocolError } from './trusted-error.ts';
import { registerQaraaWebSocket } from './websocket.ts';

export interface QaraaServerLogger {
  error(error: unknown): void | Promise<void>;
}

export type QaraaServerOptions = SessionServiceOptions & Readonly<{
  logger?: QaraaServerLogger;
}>;

export type QaraaInjectOptions = Readonly<{
  method?: string;
  url: string;
  headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  payload?: unknown;
}>;

export interface QaraaInjectResponse {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  json<Payload = unknown>(): Payload;
}

export type QaraaListenOptions = Readonly<{
  port: number;
  host?: string;
}>;

/** Common embedding surface; the runtime object remains the full Fastify instance. */
export interface QaraaServer {
  inject(options: QaraaInjectOptions | string): Promise<QaraaInjectResponse>;
  ready(): Promise<QaraaServer>;
  listen(options: QaraaListenOptions): Promise<string>;
  close(): Promise<void>;
}

type RequestParts = Readonly<{
  Body?: unknown;
  Params?: Readonly<{ sessionId: string }>;
  Querystring?: Readonly<{ protocolVersion?: string; requestId?: string }>;
}>;

function validationDetails(): Readonly<{ kind: string }> {
  return { kind: 'command-validation' };
}

function assertCommand<Type extends QaraaCommand['type']>(
  value: unknown,
  type: Type,
): asserts value is Extract<QaraaCommand, { type: Type }> {
  if (value && typeof value === 'object'
    && 'protocolVersion' in value
    && value.protocolVersion !== PROTOCOL_VERSION) {
    throw new TrustedProtocolError(
      'UNSUPPORTED_PROTOCOL',
      'Protocol version is not supported',
      false,
      { supportedProtocolVersion: PROTOCOL_VERSION },
    );
  }
  if (!commandValidator(value) || value.type !== type) {
    const code = type === 'observation.submit' ? 'INVALID_OBSERVATION' : 'INVALID_CORPUS';
    throw new TrustedProtocolError(code, 'Request payload is invalid', false, validationDetails());
  }
  try {
    assertValidCommand(value);
  } catch (error) {
    if (error instanceof QaraaProtocolError) throw trustProtocolError(error);
    throw error;
  }
}

function requestId(request: FastifyRequest<RequestParts>): string {
  const body = request.body;
  if (body && typeof body === 'object' && 'requestId' in body
    && typeof body.requestId === 'string' && /\S/u.test(body.requestId)) {
    return body.requestId;
  }
  const queryId = request.query?.requestId;
  if (typeof queryId === 'string' && /\S/u.test(queryId)) return queryId;
  const headerId = request.headers['x-request-id'];
  if (typeof headerId === 'string' && /\S/u.test(headerId)) return headerId;
  return randomUUID();
}

function requestedProtocolVersion(request: FastifyRequest<RequestParts>): number {
  const queryVersion = request.query?.protocolVersion;
  if (queryVersion !== undefined) return Number(queryVersion);
  const headerVersion = request.headers['x-qaraa-protocol-version'];
  if (typeof headerVersion === 'string') return Number(headerVersion);
  return PROTOCOL_VERSION;
}

function bodyValidationCode(
  request: FastifyRequest<RequestParts>,
): 'INVALID_CORPUS' | 'INVALID_OBSERVATION' {
  return (request.routeOptions.url ?? request.url).endsWith('/observations')
    ? 'INVALID_OBSERVATION'
    : 'INVALID_CORPUS';
}

function errorStatus(error: QaraaProtocolError): number {
  switch (error.code) {
    case 'SESSION_NOT_FOUND': return 404;
    case 'STALE_REVISION': return 409;
    case 'INTERNAL_ERROR': return error.retryable ? 503 : 500;
    default: return 400;
  }
}

function logUnexpected(logger: QaraaServerLogger, error: unknown): void {
  try {
    void Promise.resolve(logger.error(error)).catch(() => undefined);
  } catch {
    // A failing diagnostic sink must not weaken the transport boundary.
  }
}

function internalError(): TrustedProtocolError {
  return new TrustedProtocolError(
    'INTERNAL_ERROR',
    'An internal error occurred',
    false,
    {},
  );
}

async function respond(
  request: FastifyRequest<RequestParts>,
  reply: FastifyReply,
  logger: QaraaServerLogger,
  operation: () => Promise<unknown>,
  successStatus = 200,
): Promise<unknown> {
  try {
    const result = await operation();
    return reply.status(successStatus).send(result);
  } catch (error) {
    const safeError = error instanceof TrustedProtocolError
      ? error
      : internalError();
    if (!(error instanceof TrustedProtocolError)) logUnexpected(logger, error);
    const envelope: QaraaErrorEnvelope = safeError.toEnvelope(requestId(request));
    return reply.status(errorStatus(safeError)).send(envelope);
  }
}

export function createQaraaServer(options: QaraaServerOptions): QaraaServer {
  const server = Fastify({ logger: false });
  const service = new SessionService(options);
  const logger = options.logger ?? console;

  registerQaraaWebSocket(server, service, logger);

  server.setErrorHandler((error, request: FastifyRequest<RequestParts>, reply) => {
    const invalidJson = error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'FST_ERR_CTP_INVALID_JSON_BODY';
    if (invalidJson) {
      const envelope = new TrustedProtocolError(
        bodyValidationCode(request),
        'Request body is not valid JSON',
        false,
        {},
      ).toEnvelope(requestId(request));
      return reply.status(400).send(envelope);
    }
    logUnexpected(logger, error);
    return reply.status(500).send(internalError().toEnvelope(requestId(request)));
  });

  server.setNotFoundHandler((request: FastifyRequest<RequestParts>, reply) => {
    const envelope = new TrustedProtocolError(
      'SESSION_NOT_FOUND',
      'Route was not found',
      false,
      {},
    ).toEnvelope(requestId(request));
    return reply.status(404).send(envelope);
  });

  server.post('/v1/sessions', async (request: FastifyRequest<RequestParts>, reply) => (
    respond(request, reply, logger, async () => {
      assertCommand(request.body, 'session.create');
      return service.create(request.body as SessionCreateCommand);
    }, 201)
  ));

  server.get('/v1/sessions/:sessionId', async (request: FastifyRequest<RequestParts>, reply) => (
    respond(request, reply, logger, async () => {
      const command = {
        protocolVersion: requestedProtocolVersion(request),
        requestId: requestId(request),
        type: 'session.get',
        sessionId: request.params?.sessionId,
      };
      assertCommand(command, 'session.get');
      return service.get(command as SessionGetCommand);
    })
  ));

  server.post('/v1/sessions/:sessionId/reset', async (request: FastifyRequest<RequestParts>, reply) => (
    respond(request, reply, logger, async () => {
      assertCommand(request.body, 'session.reset');
      if (request.body.sessionId !== request.params?.sessionId) {
        throw new TrustedProtocolError(
          'SESSION_NOT_FOUND',
          'Session path does not match the request payload',
          false,
          { sessionId: request.params?.sessionId ?? '' },
        );
      }
      return service.reset(request.body as SessionResetCommand);
    })
  ));

  server.post('/v1/sessions/:sessionId/observations', async (request: FastifyRequest<RequestParts>, reply) => (
    respond(request, reply, logger, async () => {
      assertCommand(request.body, 'observation.submit');
      if (request.body.sessionId !== request.params?.sessionId) {
        throw new TrustedProtocolError(
          'SESSION_NOT_FOUND',
          'Session path does not match the request payload',
          false,
          { sessionId: request.params?.sessionId ?? '' },
        );
      }
      return service.submit(request.body as ObservationSubmitCommand);
    })
  ));

  server.post('/v1/sessions/:sessionId/resume', async (request: FastifyRequest<RequestParts>, reply) => (
    respond(request, reply, logger, async () => {
      assertCommand(request.body, 'session.resume');
      if (request.body.sessionId !== request.params?.sessionId) {
        throw new TrustedProtocolError(
          'SESSION_NOT_FOUND',
          'Session path does not match the request payload',
          false,
          { sessionId: request.params?.sessionId ?? '' },
        );
      }
      return service.resume(request.body as SessionResumeCommand);
    })
  ));

  server.delete('/v1/sessions/:sessionId', async (request: FastifyRequest<RequestParts>, reply) => (
    respond(request, reply, logger, async () => {
      const command = {
        protocolVersion: requestedProtocolVersion(request),
        requestId: requestId(request),
        type: 'session.delete',
        sessionId: request.params?.sessionId,
      };
      assertCommand(command, 'session.delete');
      return service.delete(command as SessionDeleteCommand);
    })
  ));

  return server as unknown as QaraaServer;
}
