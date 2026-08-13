import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactiveController, ReactiveControllerHost } from 'lit';

import { FakeQaraaSession } from '../../adapter-testkit/src/index.ts';
import { QaraaSessionController } from '../src/index.ts';

class Host implements ReactiveControllerHost {
  updates = 0;
  controllers: ReactiveController[] = [];
  addController(controller: ReactiveController): void { this.controllers.push(controller); }
  removeController(controller: ReactiveController): void {
    this.controllers = this.controllers.filter((candidate) => candidate !== controller);
  }
  requestUpdate(): void { this.updates += 1; }
  readonly updateComplete = Promise.resolve(true);
}

test('Lit controller follows host connection without closing the caller session', async () => {
  const host = new Host();
  const session = new FakeQaraaSession();
  const controller = new QaraaSessionController(host, session);
  assert.equal(session.subscribeCount, 0);

  controller.hostConnected();
  controller.hostConnected();
  assert.equal(controller.status, 'ready');
  assert.equal(session.subscribeCount, 1);
  session.emit(2);
  await Promise.resolve();
  assert.equal(controller.snapshot.revision, 2);
  assert.ok(host.updates >= 2);

  controller.hostDisconnected();
  assert.equal(session.unsubscribeCount, 1);
  assert.equal(session.closeCount, 0);
});
