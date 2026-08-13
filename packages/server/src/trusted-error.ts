/**
 * Internal marker for protocol errors created by trusted QARAA code.
 *
 * @license Apache-2.0
 */

import { QaraaProtocolError } from '@atqan/qaraa-protocol';
import type { QaraaErrorCode } from '@atqan/qaraa-protocol';

export class TrustedProtocolError extends QaraaProtocolError {
  constructor(
    code: QaraaErrorCode,
    message: string,
    retryable = false,
    details: ConstructorParameters<typeof QaraaProtocolError>[3] = {},
  ) {
    super(code, message, retryable, details);
    this.name = 'TrustedProtocolError';
  }
}

export function trustProtocolError(error: QaraaProtocolError): TrustedProtocolError {
  return error instanceof TrustedProtocolError
    ? error
    : new TrustedProtocolError(error.code, error.message, error.retryable, error.details);
}
