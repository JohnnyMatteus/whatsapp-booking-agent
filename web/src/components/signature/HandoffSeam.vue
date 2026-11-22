<script setup lang="ts">
import { clock } from '../../lib/time';
import { REASON_LABEL } from '../../lib/labels';
import type { HandoffReason } from '../../api/schemas';

// Costura: o ponto exato em que o bot passa a conversa para uma pessoa (ou a recebe de volta).
const props = defineProps<{ kind: 'handoff' | 'resumed'; at: string; reason?: HandoffReason }>();
const label = () => (props.kind === 'handoff' ? `Transferida · ${REASON_LABEL[props.reason ?? 'explicit_request']}` : 'Devolvida ao bot');
</script>

<template>
  <div
    class="seam"
    :class="{ 'seam--resumed': kind === 'resumed' }"
    role="separator"
    :aria-label="`${label()} às ${clock(at)}`"
    data-test="seam"
  >
    <v-chip>
      <span>{{ label() }}</span>
      <span
        class="meta ml-2"
        style="color: inherit"
      >{{ clock(at) }}</span>
    </v-chip>
  </div>
</template>
