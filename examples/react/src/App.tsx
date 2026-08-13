/** React local-session boundary example. @license Apache-2.0 */
import { useEffect, useMemo } from 'react';
import { createLocalSession } from '@atqan/qaraa-client';
import { useQaraaSession } from '@atqan/qaraa-react';
import { exampleCorpus } from '../../shared/src/fixture.ts';

export function App() {
  const session = useMemo(() => createLocalSession({ corpus: exampleCorpus }), []);
  const qaraa = useQaraaSession(session);
  useEffect(() => () => { void session.close(); }, [session]);
  return qaraa.snapshot.revision;
}
