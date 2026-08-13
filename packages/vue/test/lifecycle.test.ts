import assert from 'node:assert/strict';
import test from 'node:test';
import { effectScope, ref } from 'vue';

import { FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { useQaraaSession } from '../src/index.ts';

test('Vue composable replaces session subscriptions and stops with its scope', async () => {
  const first = new FakeQaraaSession();
  const second = new FakeQaraaSession();
  const selected = ref(first);
  const scope = effectScope();
  const qaraa = scope.run(() => useQaraaSession(selected));
  assert.ok(qaraa);
  assert.equal(qaraa.status.value, 'ready');

  selected.value = second;
  assert.equal(first.unsubscribeCount, 1);
  assert.equal(first.closeCount, 0);
  second.emit(2);
  await Promise.resolve();
  assert.equal(qaraa.snapshot.value?.revision, 2);

  scope.stop();
  assert.equal(second.unsubscribeCount, 1);
  assert.equal(second.closeCount, 0);
});
