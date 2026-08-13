import test from 'node:test';
import { Window } from 'happy-dom';
import React, { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { adapterCleanupCycles, adapterContractCases, type AdapterContractHarness, type FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { useQaraaSession, type UseQaraaSessionResult } from '../src/index.ts';

function harness(): AdapterContractHarness {
  const browser = new Window({ url: 'https://example.test' });
  Object.assign(globalThis, { window: browser, document: browser.document, IS_REACT_ACT_ENVIRONMENT: true });
  const host = browser.document.createElement('div');
  let root: Root; let value: UseQaraaSessionResult;
  return {
    async mount(session: FakeQaraaSession) {
      function Probe() { value = useQaraaSession(session); return null; }
      root = createRoot(host);
      await act(async () => { root.render(React.createElement(StrictMode, null, React.createElement(Probe))); });
    },
    readRevision: () => value.snapshot.revision,
    async submit() { let result!: Awaited<ReturnType<typeof value.submit>>; await act(async () => { result = await value.submit({ observationId: 'contract', sourceRevision: value.snapshot.revision, isFinal: true, receivedAtMs: 0, tokens: [] }); }); return result; },
    async reset() { let result!: Awaited<ReturnType<typeof value.reset>>; await act(async () => { result = await value.reset(); }); return result; },
    async run(action) { await act(async () => action()); },
    async flush() { await act(async () => undefined); },
    async unmount() { await act(async () => root.unmount()); browser.close(); },
  };
}

test('React public hook satisfies the shared adapter contract', () => adapterContractCases(harness));
test('React public hook survives 100 StrictMode lifecycles', () => adapterCleanupCycles(harness));
