'use client';
/** Client-only React adapter boundary; the caller owns the session. @license Apache-2.0 */
import type { QaraaSession } from '@atqan/qaraa-client';
import { useQaraaSession } from '@atqan/qaraa-react';

export function QaraaClient({ session }: { session: QaraaSession }) {
  const qaraa = useQaraaSession(session);
  return <output>{qaraa.snapshot.revision}</output>;
}
