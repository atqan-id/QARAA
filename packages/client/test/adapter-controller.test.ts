import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReadingSnapshot, RecitationObservation } from '@atqan/qaraa-core';
import { createAdapterController } from '../src/index.ts';
import type { QaraaSession, SnapshotListener } from '../src/index.ts';

const location = { surah: 1, ayah: 1, word: 1, symbol: 1 } as const;

function snapshot(revision: number): ReadingSnapshot {
  return {
    revision,
    observationId: null,
    display: { location, isReread: false, activeWordId: null },
    commit: { location, completedWordIds: [] },
    confidence: null,
    finding: null,
  };
}

class FakeSession implements QaraaSession {
  subscribeCount = 0;
  unsubscribeCount = 0;
  closeCount = 0;
  current = snapshot(0);
  listeners = new Set<SnapshotListener>();

  getSnapshot(): ReadingSnapshot { return this.current; }
  subscribe(listener: SnapshotListener): () => void {
    this.subscribeCount += 1;
    this.listeners.add(listener);
    listener(this.current);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.unsubscribeCount += 1;
      this.listeners.delete(listener);
    };
  }
  async submit(_observation: RecitationObservation): Promise<ReadingSnapshot> {
    return this.current;
  }
  async reset(): Promise<ReadingSnapshot> { return this.current; }
  async close(): Promise<void> { this.closeCount += 1; }
  emit(revision: number): void {
    this.current = snapshot(revision);
    for (const listener of this.listeners) listener(this.current);
  }
}

test('adapter controller double-gates revisions and keeps disposal separate from close', async () => {
  const session = new FakeSession();
  const controller = createAdapterController(session);
  controller.connect();
  controller.connect();
  assert.equal(session.subscribeCount, 1);

  session.emit(2);
  session.emit(1);
  await Promise.resolve();
  assert.equal(controller.read().snapshot.revision, 2);

  await controller.dispose();
  await controller.dispose();
  assert.equal(session.unsubscribeCount, 1);
  assert.equal(session.closeCount, 0);

  const close = controller.close;
  await close();
  await close();
  assert.equal(session.closeCount, 1);
  assert.equal(controller.read().status, 'closed');
});

test('adapter controller rejects a queued snapshot after explicit close', async () => {
  const session = new FakeSession();
  const controller = createAdapterController(session);
  controller.connect();
  session.emit(2);
  await controller.close();
  await Promise.resolve();
  assert.equal(controller.read().snapshot.revision, 0);
});

test('adapter controller invalidates queued snapshots when disposed', async () => {
  const session = new FakeSession();
  const controller = createAdapterController(session);
  const revisions: number[] = [];
  controller.subscribe(() => revisions.push(controller.read().snapshot.revision));
  controller.connect();

  session.emit(2);
  await controller.dispose();
  await Promise.resolve();

  assert.equal(controller.read().snapshot.revision, 0);
  assert.deepEqual(revisions, [0]);
});

test('adapter controller publishes closed state before releasing listeners', async () => {
  const session = new FakeSession();
  const controller = createAdapterController(session);
  const statuses: string[] = [];
  controller.subscribe(() => statuses.push(controller.read().status));
  controller.connect();

  await controller.close();

  assert.deepEqual(statuses, ['ready', 'closed']);
});

test('adapter controller isolates throwing listeners', () => {
  const session = new FakeSession();
  const controller = createAdapterController(session);
  let delivered = 0;
  controller.subscribe(() => { throw new Error('listener failed'); });
  controller.subscribe(() => { delivered += 1; });

  controller.connect();
  controller.connect();

  assert.equal(delivered, 1);
  assert.equal(session.subscribeCount, 1);
});
