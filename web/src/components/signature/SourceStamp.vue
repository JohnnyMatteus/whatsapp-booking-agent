<script setup lang="ts">
import { mdiDatabaseSearchOutline } from '@mdi/js';
import { computed } from 'vue';
import type { SlotCitation } from '../../api/schemas';
import { clock, slotTime } from '../../lib/time';

// Carimbo de fonte: o horário citado pelo bot veio desta consulta à agenda (ferramenta).
const props = defineProps<{ citations: readonly SlotCitation[] }>();
const fetchedAt = computed(() => [...props.citations].map((c) => c.fetchedAt).sort().at(-1) ?? '');
</script>

<template>
  <v-menu
    v-if="citations.length > 0"
    :close-on-content-click="false"
    location="top start"
  >
    <template #activator="{ props: activator }">
      <v-btn
        v-bind="activator"
        data-test="source-stamp"
        variant="outlined"
        size="x-small"
        height="24"
        rounded="pill"
        :prepend-icon="mdiDatabaseSearchOutline"
        :aria-label="`Fonte dos horários citados: agenda, consultada às ${clock(fetchedAt)}`"
      >
        <span class="tnum">fonte: agenda · {{ clock(fetchedAt) }}</span>
      </v-btn>
    </template>
    <v-card
      min-width="280"
      max-width="360"
      border
      class="pa-3"
    >
      <div class="text-subtitle-2 mb-2">
        Chamada de ferramenta
      </div>
      <div
        class="meta mb-2"
        data-test="stamp-tool"
      >
        {{ citations[0]?.tool }} · consultada às {{ clock(fetchedAt) }}
      </div>
      <div
        v-for="c in citations"
        :key="c.sessionId"
        class="mb-2"
      >
        <div class="font-weight-medium">
          {{ c.title }}
        </div>
        <div class="meta">
          {{ slotTime(c.startsAt, c.timezone) }}–{{ clock(c.endsAt, c.timezone) }} · {{ c.instructorName }}
        </div>
        <div class="meta">
          {{ c.confirmedCount }} de {{ c.capacity }} vagas ocupadas · fila {{ c.waitlistCount }}
        </div>
      </div>
    </v-card>
  </v-menu>
</template>
