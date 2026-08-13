/** @license Apache-2.0 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateFixture } from './generate-js-conformance-result.mjs';

test('TypeScript baseline rejects a fixture whose manifest validity is wrong', () => {
  const invalidObservation = {
    observationId: 'o',
    sourceRevision: -1,
    isFinal: true,
    receivedAtMs: 1,
    tokens: [],
  };
  assert.throws(
    () => validateFixture({ schema: 'observation', valid: true }, invalidObservation),
    /marked valid but failed/,
  );
  assert.equal(
    validateFixture({ schema: 'observation', valid: false }, invalidObservation),
    null,
  );
});
