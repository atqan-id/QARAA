import test from 'node:test';
import { Window } from 'happy-dom';
import { h } from 'preact';
import { act } from 'preact/test-utils';
import { render } from 'preact';
import { adapterCleanupCycles, adapterContractCases, type AdapterContractHarness, type FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { useQaraaSession, type UseQaraaSessionResult } from '../src/index.ts';

function harness(): AdapterContractHarness {
  const browser = new Window({ url: 'https://example.test' });
  Object.assign(globalThis, { window: browser, document: browser.document });
  const host = browser.document.createElement('div'); let value: UseQaraaSessionResult;
  return {
    mount(session: FakeQaraaSession) { function Probe() { value = useQaraaSession(session); return null; } act(() => render(h(Probe), host)); },
    readRevision: () => value.snapshot.revision,
    submit: () => value.submit({ observationId: 'contract', sourceRevision: value.snapshot.revision, isFinal: true, receivedAtMs: 0, tokens: [] }),
    reset: () => value.reset(),
    async flush() { await act(async () => undefined); },
    async unmount() { act(() => render(null, host)); await act(async () => undefined); browser.close(); },
  };
}
test('Preact public hook satisfies the shared adapter contract', () => adapterContractCases(harness));
test('Preact public hook survives 100 lifecycles', () => adapterCleanupCycles(harness));
