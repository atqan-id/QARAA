/** Preact session hook. @license Apache-2.0 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type {
  QuranLocation,
  ReadingSnapshot,
  RecitationObservation,
} from '@atqan/qaraa-core';
import {
  createAdapterController,
  type QaraaSession,
  type QaraaStatus,
} from '@atqan/qaraa-client';

export type UseQaraaSessionResult = Readonly<{
  snapshot: ReadingSnapshot;
  status: QaraaStatus;
  error: Error | null;
  submit(observation: RecitationObservation): Promise<ReadingSnapshot>;
  reset(location?: QuranLocation): Promise<ReadingSnapshot>;
  close(): Promise<void>;
}>;

/** Unmount releases the subscription only; close is explicit caller intent. */
export function useQaraaSession(session: QaraaSession): UseQaraaSessionResult {
  const controller = useMemo(() => createAdapterController(session), [session]);
  const [published, setPublished] = useState(() => ({ controller, state: controller.read() }));
  const state = published.controller === controller ? published.state : controller.read();

  useEffect(() => {
    controller.connect();
    setPublished({ controller, state: controller.read() });
    const unsubscribe = controller.subscribe(() => setPublished({ controller, state: controller.read() }));
    return () => {
      unsubscribe();
      void controller.dispose();
    };
  }, [controller]);

  return useMemo(() => ({
    ...state,
    submit: controller.submit,
    reset: controller.reset,
    close: controller.close,
  }), [state, controller]);
}
