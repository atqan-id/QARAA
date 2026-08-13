import test from 'node:test';
import { effectScope } from 'vue';
import { adapterCleanupCycles, adapterContractCases, type AdapterContractHarness, type FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { useQaraaSession } from '../src/index.ts';
function harness(): AdapterContractHarness { let scope: ReturnType<typeof effectScope>; let value: ReturnType<typeof useQaraaSession>;
  return { mount(session: FakeQaraaSession) { scope = effectScope(); value = scope.run(() => useQaraaSession(session))!; }, readRevision: () => value.snapshot.value?.revision ?? null,
    submit: () => value.submit({ observationId:'contract', sourceRevision:value.snapshot.value!.revision,isFinal:true,receivedAtMs:0,tokens:[] }), reset:()=>value.reset(), unmount(){scope.stop();} }; }
test('Vue public composable satisfies the shared adapter contract',()=>adapterContractCases(harness));
test('Vue public composable survives 100 scopes',()=>adapterCleanupCycles(harness));
