import { useEffect, useMemo } from 'preact/hooks';
import { createLocalSession } from '@atqan/qaraa-client';
import { useQaraaSession } from '@atqan/qaraa-preact';
import { exampleCorpus } from '../../shared/src/fixture.ts';

export function App() {
  const session = useMemo(() => createLocalSession({ corpus: exampleCorpus }), []);
  const qaraa = useQaraaSession(session);
  useEffect(() => () => { void session.close(); }, [session]);
  return qaraa.snapshot.revision;
}
