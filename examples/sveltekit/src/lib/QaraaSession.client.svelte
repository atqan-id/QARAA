<script lang="ts">
import type { QaraaSession } from '@atqan/qaraa-client';
import { createQaraaStore } from '@atqan/qaraa-svelte';
let { session }: { session: QaraaSession } = $props();
const qaraa = createQaraaStore(session);
</script>
<output>{$qaraa.snapshot.revision}</output>
