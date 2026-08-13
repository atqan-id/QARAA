/** Angular signal service. @license Apache-2.0 */
import { Injectable, signal, type OnDestroy, type Signal } from '@angular/core';
import type { QaraaSession } from '@atqan/qaraa-client';
import type { ReadingSnapshot, RecitationObservation, QuranLocation } from '@atqan/qaraa-core';
import { createAdapterController, type QaraaStatus } from '@atqan/qaraa-client';

@Injectable()
export class QaraaSessionService implements OnDestroy {
  private readonly snapshotState = signal<ReadingSnapshot | null>(null);
  readonly snapshot: Signal<ReadingSnapshot | null> = this.snapshotState.asReadonly();
  readonly status = signal<QaraaStatus>('idle');
  readonly error = signal<Error | null>(null);
  private controller: ReturnType<typeof createAdapterController> | undefined;
  private release: (() => void) | undefined;

  connect(session: QaraaSession): void {
    this.disconnect();
    this.controller = createAdapterController(session);
    this.controller.connect();
    const update = (): void => {
      const state = this.controller!.read();
      this.snapshotState.set(state.snapshot);
      this.status.set(state.status);
      this.error.set(state.error);
    };
    update();
    this.release = this.controller.subscribe(update);
  }

  disconnect(): void {
    this.release?.();
    this.release = undefined;
    if (this.controller) void this.controller.dispose();
    this.controller = undefined;
  }
  ngOnDestroy(): void { this.disconnect(); }
  private active(): ReturnType<typeof createAdapterController> {
    if (!this.controller) throw new Error('QARAA_SESSION_NOT_CONNECTED');
    return this.controller;
  }
  submit(observation: RecitationObservation): Promise<ReadingSnapshot> { return this.active().submit(observation); }
  reset(location?: QuranLocation): Promise<ReadingSnapshot> { return this.active().reset(location); }
  close(): Promise<void> { return this.active().close(); }
}
