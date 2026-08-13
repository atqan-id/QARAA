/**
 * Narrow compatibility for thread-stream 4.2 with @types/node 26.
 *
 * @license Apache-2.0
 */

import 'node:worker_threads';

declare module 'node:worker_threads' {
  type TransferListItem = Transferable;
}
