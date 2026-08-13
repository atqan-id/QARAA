/**
 * Local adapter lifecycle contract.
 *
 * @license Apache-2.0
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { QuranCorpus, ReadingSnapshot } from '@atqan/qaraa-core';
import { createLocalSession } from '../src/index.ts';

const corpus: QuranCorpus = {
  corpusId: 'client-local-corpus',
  revision: '1',
  symbols: [
    {
      id: 'symbol-1',
      text: 'بِ',
      phoneme: 'bi',
      location: { surah: 1, ayah: 1, word: 1, symbol: 1 },
    },
  ],
  words: [
    {
      id: 'word-1',
      text: 'بِ',
      symbolIds: ['symbol-1'],
      location: { surah: 1, ayah: 1, word: 1 },
    },
  ],
};

test('delivers the current local snapshot immediately and each accepted update', async () => {
  const session = createLocalSession({ corpus });
  const received: ReadingSnapshot[] = [];

  session.subscribe((snapshot) => received.push(snapshot));
  const submitted = await session.submit({
    observationId: 'local-observation-1',
    sourceRevision: 1,
    isFinal: true,
    receivedAtMs: 1,
    tokens: [{ id: 'local-token-1', text: 'بِ', phonemes: ['bi'] }],
  });
  const duplicate = await session.submit({
    observationId: 'local-observation-1',
    sourceRevision: 1,
    isFinal: true,
    receivedAtMs: 1,
    tokens: [{ id: 'local-token-1', text: 'بِ', phonemes: ['bi'] }],
  });

  assert.equal(session.getSnapshot(), submitted);
  assert.equal(duplicate, submitted);
  assert.deepEqual(received.map(({ revision }) => revision), [0, 1]);
  assert.equal(received[1], submitted);
});

test('stops local notifications after unsubscribe', async () => {
  const session = createLocalSession({ corpus });
  const revisions: number[] = [];
  const unsubscribe = session.subscribe((snapshot) => revisions.push(snapshot.revision));

  unsubscribe();
  unsubscribe();
  await session.reset();

  assert.deepEqual(revisions, [0]);
});

test('closes a local session idempotently and rejects later mutation', async () => {
  const session = createLocalSession({ corpus });

  await session.close();
  await session.close();

  await assert.rejects(
    session.reset(),
    /session is closed/u,
  );
});

test('isolates a throwing local subscriber without starving later subscribers', async () => {
  const session = createLocalSession({ corpus });
  const received: number[] = [];
  session.subscribe((snapshot) => {
    if (snapshot.revision > 0) throw new Error('listener failed');
  });
  session.subscribe((snapshot) => received.push(snapshot.revision));

  const result = await session.reset();

  assert.equal(result.revision, 1);
  assert.deepEqual(received, [0, 1]);
});

test('rolls back a local subscription when immediate delivery throws', async () => {
  const session = createLocalSession({ corpus });
  let calls = 0;

  assert.throws(() => session.subscribe(() => {
    calls += 1;
    throw new Error('immediate listener failed');
  }), /immediate listener failed/u);
  await session.reset();

  assert.equal(calls, 1);
});

test('skips a local listener unsubscribed by an earlier publication listener', async () => {
  const session = createLocalSession({ corpus });
  let unsubscribeLater = (): void => undefined;
  const laterRevisions: number[] = [];
  session.subscribe((snapshot) => {
    if (snapshot.revision > 0) unsubscribeLater();
  });
  unsubscribeLater = session.subscribe((snapshot) => {
    laterRevisions.push(snapshot.revision);
  });

  await session.reset();

  assert.deepEqual(laterRevisions, [0]);
});

test('stops local publication when an earlier listener closes the session', async () => {
  const session = createLocalSession({ corpus });
  const laterRevisions: number[] = [];
  session.subscribe((snapshot) => {
    if (snapshot.revision > 0) void session.close();
  });
  session.subscribe((snapshot) => laterRevisions.push(snapshot.revision));

  const result = await session.reset();
  await session.close();

  assert.equal(result.revision, 1);
  assert.deepEqual(laterRevisions, [0]);
});
