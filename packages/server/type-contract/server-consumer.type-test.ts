/**
 * Strict downstream contract for the embeddable QARAA server.
 *
 * @license Apache-2.0
 */

import type { QuranCorpus } from '@atqan/qaraa-core';
import {
  createQaraaServer,
  type QaraaServer,
} from '@atqan/qaraa-server';

declare const corpus: QuranCorpus;

const server: QaraaServer = createQaraaServer({ corpus });
const response = await server.inject({
  method: 'POST',
  url: '/v1/sessions',
  payload: {
    protocolVersion: 1,
    requestId: 'consumer-create',
    type: 'session.create',
    corpusId: corpus.corpusId,
  },
});
const payload: unknown = response.json();
void payload;
await server.ready();
await server.listen({ port: 0, host: '127.0.0.1' });
await server.close();
