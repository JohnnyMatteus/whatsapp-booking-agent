<script setup lang="ts">
import { computed } from 'vue';
import { DEADLINE_LABEL, deadlineOf, elapsed } from '../../lib/time';

// Anel de prazo: preenche até a meta de primeira resposta; verde, âmbar e vermelho, sempre com texto.
const props = defineProps<{ handoffAt: string; now: Date; goalSeconds: number }>();
const RADIUS = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const deadline = computed(() => deadlineOf(props.handoffAt, props.now, props.goalSeconds));
const color = computed(() => ({ ok: 'success', soon: 'warning', overdue: 'error' })[deadline.value.status]);
const text = computed(() => elapsed(props.handoffAt, props.now));
</script>

<template>
  <div
    class="d-inline-flex align-center ga-2"
    data-test="wait-ring"
    :data-status="deadline.status"
    role="img"
    :aria-label="`Espera de ${text}: ${DEADLINE_LABEL[deadline.status]}`"
  >
    <svg
      width="36"
      height="36"
      viewBox="0 0 36 36"
      aria-hidden="true"
    >
      <circle
        cx="18"
        cy="18"
        :r="RADIUS"
        fill="none"
        stroke="currentColor"
        stroke-opacity="0.15"
        stroke-width="4"
      />
      <circle
        cx="18"
        cy="18"
        :r="RADIUS"
        fill="none"
        :stroke="`rgb(var(--v-theme-${color}))`"
        stroke-width="4"
        stroke-linecap="round"
        :stroke-dasharray="CIRCUMFERENCE"
        :stroke-dashoffset="CIRCUMFERENCE * (1 - Math.max(deadline.ratio, 0.04))"
        transform="rotate(-90 18 18)"
      />
    </svg>
    <div>
      <div class="font-weight-medium tnum">
        {{ text }}
      </div>
      <div
        class="meta"
        :style="{ color: `rgb(var(--v-theme-${color}))` }"
      >
        {{ DEADLINE_LABEL[deadline.status] }}
      </div>
    </div>
  </div>
</template>
