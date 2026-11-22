<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useThumbnail } from '../composables/panel';

const props = defineProps<{ messageId: string }>();
const thumbnail = useThumbnail(() => props.messageId);
const url = ref<string | null>(null);

// Blob autenticado vira URL local; liberada ao trocar ou sair.
watch(
  () => thumbnail.data.value,
  (blob) => {
    if (url.value) globalThis.URL.revokeObjectURL(url.value);
    url.value = blob ? globalThis.URL.createObjectURL(blob) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => url.value && globalThis.URL.revokeObjectURL(url.value));
</script>

<template>
  <img
    v-if="url"
    :src="url"
    alt="Imagem enviada pelo aluno (miniatura)"
    class="thumb mt-2"
    data-test="media-thumbnail"
  >
  <div
    v-else-if="thumbnail.isError.value"
    class="meta mt-2"
    data-test="media-thumbnail-missing"
  >
    miniatura indisponível (expira em 30 dias)
  </div>
</template>

<style scoped>
.thumb { display: block; max-width: 256px; max-height: 256px; border-radius: 8px; }
</style>
