import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoot } from 'solid-js';

import { FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { createQaraaSession } from '../src/index.ts';

test('Solid primitive requires an owner and releases only its subscription', async () => {
  const session = new FakeQaraaSession();
  assert.throws(() => createQaraaSession(session), /QARAA_SOLID_OWNER_REQUIRED/u);

  let dispose = (): void => undefined;
  let status = '';
  createRoot((rootDispose) => {
    dispose = rootDispose;
    const qaraa = createQaraaSession(session);
    status = qaraa.status();
  });
  assert.equal(status, 'ready');
  assert.equal(session.subscribeCount, 1);
  dispose();
  assert.equal(session.unsubscribeCount, 1);
  assert.equal(session.closeCount, 0);
});
