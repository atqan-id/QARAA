<script setup lang="ts">
import type { QaraaSession } from '@atqan/qaraa-client';
import { useQaraaSession } from '@atqan/qaraa-vue';
const props = defineProps<{ session: QaraaSession }>();
const qaraa = useQaraaSession(() => props.session);
</script>
<template><output>{{ qaraa.snapshot.value?.revision ?? 0 }}</output></template>
