import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { createQaraaStore } from '../src/index.ts';

test('Svelte store shares one subscription and releases it after the last subscriber', async () => {
  const session = new FakeQaraaSession();
  const store = createQaraaStore(session);
  const revisions: number[] = [];
  const first = store.subscribe((state) => revisions.push(state.snapshot.revision));
  const second = store.subscribe(() => undefined);
  assert.equal(session.subscribeCount, 1);

  session.emit(2);
  await Promise.resolve();
  assert.equal(revisions.at(-1), 2);
  first();
  assert.equal(session.unsubscribeCount, 0);
  second();
  assert.equal(session.unsubscribeCount, 1);
  assert.equal(session.closeCount, 0);
});
