import { onScopeDispose } from 'vue';
import { createApp } from 'vue';
import App from './App.vue';
import { createLocalSession } from '@atqan/qaraa-client';
import { useQaraaSession } from '@atqan/qaraa-vue';
import { exampleCorpus } from '../../shared/src/fixture.ts';

export function useExampleSession() {
  const session = createLocalSession({ corpus: exampleCorpus });
  onScopeDispose(() => { void session.close(); });
  return useQaraaSession(session);
}

if (typeof document !== 'undefined') createApp(App).mount('#app');
