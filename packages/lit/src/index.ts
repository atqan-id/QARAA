/** Lit reactive controller. @license Apache-2.0 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { QaraaSession } from '@atqan/qaraa-client';
import type {
  QuranLocation,
  ReadingSnapshot,
  RecitationObservation,
} from '@atqan/qaraa-core';
import {
  createAdapterController,
  type QaraaStatus,
} from '@atqan/qaraa-client';

export class QaraaSessionController implements ReactiveController {
  private readonly controller;
  snapshot: ReadingSnapshot;
  status: QaraaStatus = 'idle';
  error: Error | null = null;
  private release: (() => void) | undefined;
  private readonly host: ReactiveControllerHost;

  constructor(
    host: ReactiveControllerHost,
    session: QaraaSession,
  ) {
    this.host = host;
    this.controller = createAdapterController(session);
    this.snapshot = this.controller.read().snapshot;
    host.addController(this);
  }

  hostConnected(): void {
    if (this.release) return;
    this.controller.connect();
    const update = (): void => {
      const next = this.controller.read();
      this.snapshot = next.snapshot;
      this.status = next.status;
      this.error = next.error;
      this.host.requestUpdate();
    };
    update();
    this.release = this.controller.subscribe(update);
  }

  hostDisconnected(): void {
    this.release?.();
    this.release = undefined;
    void this.controller.dispose();
  }

  submit(observation: RecitationObservation): Promise<ReadingSnapshot> {
    return this.controller.submit(observation);
  }

  reset(location?: QuranLocation): Promise<ReadingSnapshot> {
    return this.controller.reset(location);
  }

  close(): Promise<void> {
    return this.controller.close();
  }
}
