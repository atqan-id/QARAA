import assert from 'node:assert/strict';
import test from 'node:test';

import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { useQaraaSession } from '../src/index.ts';

test('Preact session replacement exposes matching snapshot and actions before effects flush', async () => {
  const window = new Window({ url: 'https://example.test' });
  Object.assign(globalThis, {
    document: window.document,
    window,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
  });
  const first = new FakeQaraaSession();
  const second = new FakeQaraaSession();
  first.emit(11);
  second.emit(22);
  const observed: Array<{ revision: number; submit: () => Promise<unknown> }> = [];

  function Probe({ session }: { session: FakeQaraaSession }) {
    const state = useQaraaSession(session);
    observed.push({ revision: state.snapshot.revision, submit: () => state.submit({
      observationId: 'obs',
      sourceRevision: state.snapshot.revision,
      isFinal: true,
      receivedAtMs: 0,
      tokens: [],
    }) });
    return null;
  }

  const host = window.document.createElement('div');
  render(h(Probe, { session: first }), host);
  render(h(Probe, { session: second }), host);
  const latest = observed.at(-1)!;
  assert.equal(latest.revision, 22);
  await latest.submit();
  assert.equal(first.submitCount, 0);
  assert.equal(second.submitCount, 1);
  render(null, host);
  window.close();
});
