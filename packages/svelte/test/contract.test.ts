import test from 'node:test';
import { adapterCleanupCycles, adapterContractCases, type AdapterContractHarness, type FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { createQaraaStore, type QaraaStore } from '../src/index.ts';
function harness():AdapterContractHarness{let value:QaraaStore;let revision:number|null=null;let release:()=>void;return{mount(session:FakeQaraaSession){value=createQaraaStore(session);release=value.subscribe((state)=>{revision=state.snapshot.revision;});},readRevision:()=>revision,submit:()=>value.submit({observationId:'contract',sourceRevision:revision!,isFinal:true,receivedAtMs:0,tokens:[]}),reset:()=>value.reset(),unmount(){release();}};}
test('Svelte public store satisfies the shared adapter contract',()=>adapterContractCases(harness));
test('Svelte public store survives 100 subscriptions',()=>adapterCleanupCycles(harness));
