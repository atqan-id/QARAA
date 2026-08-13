/** React session hook. @license Apache-2.0 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReadingSnapshot, RecitationObservation, QuranLocation } from '@atqan/qaraa-core';
import type { QaraaSession } from '@atqan/qaraa-client';
import { createAdapterController, type QaraaState, type QaraaStatus } from '@atqan/qaraa-client';
export type UseQaraaSessionResult = Readonly<{ snapshot: ReadingSnapshot; status: QaraaStatus; error: Error | null; submit(observation: RecitationObservation): Promise<ReadingSnapshot>; reset(location?: QuranLocation): Promise<ReadingSnapshot>; close(): Promise<void> }>;
/** Unmount releases the subscription only; close is explicit caller intent. */
export function useQaraaSession(session: QaraaSession): UseQaraaSessionResult {
 const controller = useMemo(() => createAdapterController(session), [session]);
 useEffect(() => { controller.connect(); return () => { void controller.dispose(); }; }, [controller]);
 const state = useSyncExternalStore(controller.subscribe, controller.read, controller.read) as QaraaState;
 return useMemo(() => ({ ...state, submit: controller.submit, reset: controller.reset, close: controller.close }), [state, controller]);
}
