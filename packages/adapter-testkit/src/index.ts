/** Test-only fake session and adapter contract helpers. @license Apache-2.0 */

import type { ReadingSnapshot } from '@atqan/qaraa-core';
import type { RecitationObservation } from '@atqan/qaraa-core';
import type { QaraaSession } from '@atqan/qaraa-client';
export { createAdapterController } from '@atqan/qaraa-client';
export type {
  QaraaAdapterController,
  QaraaState,
  QaraaStatus,
} from '@atqan/qaraa-client';

export class FakeQaraaSession implements QaraaSession {
  subscribeCount = 0;
  unsubscribeCount = 0;
  submitCount = 0;
  resetCount = 0;
  closeCount = 0;
  submitFailure: Error | null = null;
  resetFailure: Error | null = null;
  private readonly listeners = new Set<(snapshot: ReadingSnapshot) => void>();
  private snapshot: ReadingSnapshot = {
    revision: 0,
    observationId: null,
    display: {
      location: { surah: 1, ayah: 1, word: 1, symbol: 1 },
      isReread: false,
      activeWordId: null,
    },
    commit: {
      location: { surah: 1, ayah: 1, word: 1, symbol: 1 },
      completedWordIds: [],
    },
    confidence: null,
    finding: null,
  };

  getSnapshot(): ReadingSnapshot { return this.snapshot; }
  subscribe(listener: (snapshot: ReadingSnapshot) => void): () => void {
    this.subscribeCount += 1;
    this.listeners.add(listener);
    listener(this.snapshot);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.unsubscribeCount += 1;
      this.listeners.delete(listener);
    };
  }
  async submit(_observation?: RecitationObservation): Promise<ReadingSnapshot> {
    this.submitCount += 1;
    if (this.submitFailure) throw this.submitFailure;
    return this.snapshot;
  }
  async reset(): Promise<ReadingSnapshot> {
    this.resetCount += 1;
    if (this.resetFailure) throw this.resetFailure;
    return this.snapshot;
  }
  async close(): Promise<void> { this.closeCount += 1; }
  emit(revision: number): void {
    this.snapshot = { ...this.snapshot, revision };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

export type AdapterContractHarness = Readonly<{
  mount(session: FakeQaraaSession): Promise<void> | void;
  replace?(session: FakeQaraaSession): Promise<void> | void;
  readRevision(): number | null;
  submit(): Promise<ReadingSnapshot>;
  reset(): Promise<ReadingSnapshot>;
  /** Lets renderer harnesses wrap synchronous external-store updates in act(). */
  run?(action: () => void): Promise<void> | void;
  /** Flushes the framework's native render/effect queue. */
  flush?(): Promise<void> | void;
  unmount(): Promise<void> | void;
}>;

/** Shared behavior cases consumed by every framework-specific mount harness. */
export async function adapterContractCases(
  createHarness: () => AdapterContractHarness,
): Promise<void> {
  const session = new FakeQaraaSession();
  const harness = createHarness();
  await harness.mount(session);
  await harness.flush?.();

  const emitRevisions = (): void => { session.emit(2); session.emit(1); };
  if (harness.run) await harness.run(emitRevisions); else emitRevisions();
  await harness.flush?.();
  await Promise.resolve();
  if (harness.readRevision() !== 2) throw new Error('adapter accepted a stale revision');

  const setSubmitFailure = (): void => { session.submitFailure = new Error('submit failed'); };
  if (harness.run) await harness.run(setSubmitFailure); else setSubmitFailure();
  await harness.submit().then(
    () => { throw new Error('adapter swallowed submit failure'); },
    (error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'submit failed') {
        throw new Error('adapter changed submit failure');
      }
    },
  );
  const clearSubmitFailure = (): void => { session.submitFailure = null; };
  if (harness.run) await harness.run(clearSubmitFailure); else clearSubmitFailure();
  await harness.reset();
  if (session.resetCount !== 1) throw new Error('adapter did not forward reset');

  await harness.unmount();
  if (session.subscribeCount < 1 || session.unsubscribeCount !== session.subscribeCount) {
    throw new Error('adapter leaked its subscription');
  }
  if (session.closeCount !== 0) throw new Error('adapter implicitly closed the session');
}

export async function adapterCleanupCycles(
  createHarness: () => AdapterContractHarness,
  count = 100,
): Promise<void> {
  for (let cycle = 0; cycle < count; cycle += 1) {
    const session = new FakeQaraaSession();
    const harness = createHarness();
    await harness.mount(session);
    await harness.flush?.();
    await harness.unmount();
    if (session.subscribeCount < 1 || session.unsubscribeCount !== session.subscribeCount || session.closeCount !== 0) {
      throw new Error(`adapter lifecycle leak at cycle ${cycle + 1}`);
    }
  }
}
