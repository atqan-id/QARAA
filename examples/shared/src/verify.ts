import type { ReadingSnapshot } from '@atqan/qaraa-core';
import type { QaraaSession } from '@atqan/qaraa-client';
import { exampleObservation, staleExampleObservation } from './fixture.ts';

export async function verifyMountedExample(
  session: QaraaSession,
  readRevision: () => number | null,
  flush: () => Promise<void> = async () => { await Promise.resolve(); },
  run: <T>(action: () => Promise<T>) => Promise<T> = (action) => action(),
): Promise<ReadingSnapshot> {
  const revisionOne = await run(() => session.submit(exampleObservation));
  await flush();
  if (revisionOne.revision !== 1 || readRevision() !== 1) throw new Error('adapter did not publish revision one');
  const stale = await run(() => session.submit(staleExampleObservation));
  await flush();
  if (stale.revision !== 1 || readRevision() !== 1) throw new Error('adapter accepted stale revision zero');
  return stale;
}
