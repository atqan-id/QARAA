import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdapterController, FakeQaraaSession } from '../src/index.ts';

test('central controller double-gates revisions and separates disposal from close', async () => {
  const session = new FakeQaraaSession();
  const controller = createAdapterController(session);
  controller.connect();
  assert.equal(session.subscribeCount, 1);
  session.emit(2);
  session.emit(1);
  await Promise.resolve();
  assert.equal(controller.read().snapshot.revision, 2);
  await controller.dispose();
  await controller.dispose();
  assert.equal(session.unsubscribeCount, 1);
  assert.equal(session.closeCount, 0);
  await controller.close();
  await controller.close();
  assert.equal(session.closeCount, 1);
});
