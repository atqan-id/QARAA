import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { useQaraaSession } from '../src/index.ts';

test('Preact 100 mount cycles release every subscription without closing session', async () => {
  const window=new Window({url:'https://example.test'}); Object.assign(globalThis,{window,document:window.document});
  const host=window.document.createElement('div'); const session=new FakeQaraaSession();
  function Probe(){useQaraaSession(session);return null;}
  for(let cycle=0;cycle<100;cycle+=1){render(h(Probe),host);await new Promise((resolve)=>setTimeout(resolve,0));render(null,host);}
  assert.equal(session.subscribeCount,session.unsubscribeCount); assert.equal(session.closeCount,0); window.close();
});
