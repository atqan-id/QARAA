import test from 'node:test';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { adapterCleanupCycles, adapterContractCases, type AdapterContractHarness, type FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { QaraaSessionController } from '../src/index.ts';
class Host implements ReactiveControllerHost{addController(_c:ReactiveController){}removeController(_c:ReactiveController){}requestUpdate(){}readonly updateComplete=Promise.resolve(true);}
function harness():AdapterContractHarness{let value:QaraaSessionController;return{mount(session:FakeQaraaSession){value=new QaraaSessionController(new Host(),session);value.hostConnected();},readRevision:()=>value.snapshot.revision,submit:()=>value.submit({observationId:'contract',sourceRevision:value.snapshot.revision,isFinal:true,receivedAtMs:0,tokens:[]}),reset:()=>value.reset(),unmount(){value.hostDisconnected();}};}
test('Lit public reactive controller satisfies the shared adapter contract',()=>adapterContractCases(harness));
test('Lit public reactive controller survives 100 host lifecycles',()=>adapterCleanupCycles(harness));
