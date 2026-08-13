/** Solid owner-scoped session primitive. @license Apache-2.0 */
import { createSignal, getOwner, onCleanup } from 'solid-js';
import {
  createAdapterController,
  type QaraaSession,
} from '@atqan/qaraa-client';

export function createQaraaSession(session: QaraaSession) {
  if (!getOwner()) throw new Error('QARAA_SOLID_OWNER_REQUIRED');

  const controller = createAdapterController(session);
  const [state, setState] = createSignal(controller.read());
  controller.connect();
  setState(controller.read());
  const release = controller.subscribe(() => setState(controller.read()));
  onCleanup(() => {
    release();
    void controller.dispose();
  });

  return {
    snapshot: () => state().snapshot,
    status: () => state().status,
    error: () => state().error,
    submit: controller.submit,
    reset: controller.reset,
    close: controller.close,
  };
}
