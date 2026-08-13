import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
test('Angular service replaces and releases subscriptions without implicit close', async () => {
  const { QaraaSessionService } = await import('../dist/fesm2022/atqan-qaraa-angular.mjs');
  const first = new FakeQaraaSession();
  const second = new FakeQaraaSession();
  const service = new QaraaSessionService();

  service.connect(first);
  assert.equal(service.status(), 'ready');
  service.connect(second);
  assert.equal(first.unsubscribeCount, 1);
  assert.equal(first.closeCount, 0);

  second.emit(2);
  await Promise.resolve();
  assert.equal(service.snapshot()?.revision, 2);
  service.ngOnDestroy();
  assert.equal(second.unsubscribeCount, 1);
  assert.equal(second.closeCount, 0);
});
