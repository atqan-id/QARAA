import test from 'node:test';
import { createEnvironmentInjector } from '@angular/core';
import { adapterCleanupCycles, adapterContractCases, type AdapterContractHarness, type FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
type Service = import('../src/index.ts').QaraaSessionService;
function harness(): AdapterContractHarness { let injector: ReturnType<typeof createEnvironmentInjector>; let value: Service;
 return { async mount(session:FakeQaraaSession){const {QaraaSessionService}=await import('../dist/fesm2022/atqan-qaraa-angular.mjs');injector=createEnvironmentInjector([QaraaSessionService],null as never);value=injector.get(QaraaSessionService);value.connect(session);},readRevision:()=>value.snapshot()?.revision??null,
 submit:()=>value.submit({observationId:'contract',sourceRevision:value.snapshot()!.revision,isFinal:true,receivedAtMs:0,tokens:[]}),reset:()=>value.reset(),unmount(){injector.destroy();} }; }
test('Angular public injectable satisfies the shared adapter contract',()=>adapterContractCases(harness));
test('Angular public injectable survives 100 injectors',()=>adapterCleanupCycles(harness));
