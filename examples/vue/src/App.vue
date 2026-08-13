<script setup lang="ts">import { useExampleSession } from './main.ts'; const qaraa = useExampleSession();</script>
<template><output>{{ qaraa.snapshot.value?.revision ?? 0 }}</output></template>
