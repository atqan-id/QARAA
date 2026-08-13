import { onCleanup } from 'solid-js';
import { createLocalSession } from '@atqan/qaraa-client';
import { createQaraaSession } from '@atqan/qaraa-solid';
import { exampleCorpus } from '../../shared/src/fixture.ts';

export function useExampleSession() {
  const session = createLocalSession({ corpus: exampleCorpus });
  onCleanup(() => { void session.close(); });
  return createQaraaSession(session);
}
