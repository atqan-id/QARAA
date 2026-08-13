import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { useQaraaSession } from '../src/index.ts';

test('React StrictMode remount cycles release every subscription without closing session', async () => {
  const window = new Window({ url: 'https://example.test' });
  Object.assign(globalThis, { window, document: window.document });
  const host = window.document.createElement('div');
  const session = new FakeQaraaSession();
  function Probe(){ const qaraa=useQaraaSession(session); return React.createElement('output',null,qaraa.snapshot.revision); }
  for(let cycle=0;cycle<100;cycle+=1){ const root=createRoot(host); root.render(React.createElement(StrictMode,null,React.createElement(Probe))); await new Promise((resolve)=>setTimeout(resolve,0)); root.unmount(); }
  assert.equal(session.subscribeCount,session.unsubscribeCount);
  assert.equal(session.closeCount,0);
  window.close();
});
