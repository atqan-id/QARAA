/**
 * Safe, typed error values for transport boundaries.
 *
 * @license Apache-2.0
 */

import { PROTOCOL_VERSION } from './version.ts';
import type { ProtocolVersion } from './version.ts';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

type JsonContainer = JsonObject | readonly JsonValue[];

type TraversalFrame = Readonly<{
  value: unknown;
  exiting?: boolean;
}>;

function plainArrayValues(value: readonly unknown[]): readonly unknown[] | null {
  if (Object.getPrototypeOf(value) !== Array.prototype) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return null;

  const values: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    values.push(descriptor.value);
  }
  return values;
}

function plainObjectValues(value: object): readonly unknown[] | null {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;

  const values: unknown[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    values.push(descriptor.value);
  }
  return values;
}

/** Checks the lossless JSON value domain without invoking getters or recursing. */
export function isPlainJsonValue(value: unknown): value is JsonValue {
  const activeContainers = new WeakSet<JsonContainer>();
  const stack: TraversalFrame[] = [{ value }];

  try {
    while (stack.length > 0) {
      const frame = stack.pop()!;
      const current = frame.value;
      if (frame.exiting) {
        activeContainers.delete(current as JsonContainer);
        continue;
      }

      if (current === null || typeof current === 'string' || typeof current === 'boolean') continue;
      if (typeof current === 'number') {
        if (!Number.isFinite(current)) return false;
        continue;
      }
      if (typeof current !== 'object') return false;

      const container = current as JsonContainer;
      if (activeContainers.has(container)) return false;
      const children = Array.isArray(current)
        ? plainArrayValues(current)
        : plainObjectValues(current);
      if (children === null) return false;

      activeContainers.add(container);
      stack.push({ value: container, exiting: true });
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push({ value: children[index] });
      }
    }
  } catch {
    return false;
  }

  return true;
}

function assertPlainJsonObject(value: unknown, label: string): asserts value is JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || !isPlainJsonValue(value)) {
    throw new TypeError(`${label} must be a cycle-free plain JSON object`);
  }
}

export type QaraaErrorCode =
  | 'INVALID_CORPUS'
  | 'INVALID_OBSERVATION'
  | 'STALE_REVISION'
  | 'UNSUPPORTED_PROTOCOL'
  | 'SESSION_NOT_FOUND'
  | 'INTERNAL_ERROR';

export type QaraaErrorEnvelope = Readonly<{
  protocolVersion: ProtocolVersion;
  requestId: string;
  type: 'error';
  code: QaraaErrorCode;
  message: string;
  retryable: boolean;
  details: JsonObject;
}>;

export class QaraaProtocolError extends Error {
  readonly code: QaraaErrorCode;
  readonly retryable: boolean;
  readonly details: JsonObject;

  constructor(
    code: QaraaErrorCode,
    message: string,
    retryable = false,
    details: JsonObject = {},
  ) {
    super(message);
    assertPlainJsonObject(details, 'QARAA protocol error details');
    this.name = 'QaraaProtocolError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }

  toEnvelope(requestId: string): QaraaErrorEnvelope {
    assertPlainJsonObject(this.details, 'QARAA protocol error details');
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      type: 'error',
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}
