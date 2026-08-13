import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adapterCleanupCycles,
  adapterContractCases,
  createAdapterController,
  FakeQaraaSession,
  type AdapterContractHarness,
} from '../src/index.ts';

function controllerHarness(): AdapterContractHarness {
  let controller: ReturnType<typeof createAdapterController>;
  let release: (() => void) | undefined;
  return {
    mount(session: FakeQaraaSession) {
      controller = createAdapterController(session);
      controller.connect();
      release = controller.subscribe(() => undefined);
    },
    readRevision: () => controller.read().snapshot.revision,
    submit: () => controller.submit({ observationId: 'test', sourceRevision: 0, isFinal: true, receivedAtMs: 0, tokens: [] }),
    reset: () => controller.reset(),
    async unmount() { release?.(); await controller.dispose(); },
  };
}

test('shared adapter contract covers revisions, failures, actions, and caller ownership', async () => {
  await adapterContractCases(controllerHarness);
});

test('shared adapter cleanup contract survives 100 mount cycles', async () => {
  await adapterCleanupCycles(controllerHarness);
  assert.ok(true);
});
