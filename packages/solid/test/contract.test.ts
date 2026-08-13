import test from 'node:test';
import { createRoot } from 'solid-js';
import { adapterCleanupCycles, adapterContractCases, type AdapterContractHarness, type FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { createQaraaSession } from '../src/index.ts';
function harness():AdapterContractHarness{let value:ReturnType<typeof createQaraaSession>;let dispose:()=>void;return{mount(session:FakeQaraaSession){createRoot((rootDispose)=>{dispose=rootDispose;value=createQaraaSession(session);});},readRevision:()=>value.snapshot().revision,submit:()=>value.submit({observationId:'contract',sourceRevision:value.snapshot().revision,isFinal:true,receivedAtMs:0,tokens:[]}),reset:()=>value.reset(),unmount(){dispose();}};}
test('Solid public primitive satisfies the shared adapter contract',()=>adapterContractCases(harness));
test('Solid public primitive survives 100 owners',()=>adapterCleanupCycles(harness));
