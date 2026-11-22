<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { ConversationSummary } from '../api/schemas';
import { REASON_LABEL } from '../lib/labels';
import WaitRing from './signature/WaitRing.vue';

const props = defineProps<{
  conversations: readonly ConversationSummary[];
  waiting: number;
  botActive: number;
  selectedId?: string;
  goalSeconds: number;
  newIds: ReadonlySet<string>;
}>();
// Relógio da fila: reavalia os anéis de prazo a cada 30 s.
const now = ref(new Date());
const timer = setInterval(() => (now.value = new Date()), 30_000);
onBeforeUnmount(() => clearInterval(timer));

// Quem espera há mais tempo vem primeiro; depois as conversas com o bot, da mais recente.
const sorted = computed(() =>
  [...props.conversations].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'handed_off' ? -1 : 1;
    if (a.handoff && b.handoff) return Date.parse(a.handoff.at) - Date.parse(b.handoff.at);
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  }),
);
</script>

<template>
  <div>
    <header
      class="pa-4"
      data-test="queue-counter"
    >
      <template v-if="waiting > 0">
        <div
          class="display tnum"
          style="font-size: 40px; line-height: 44px"
        >
          {{ waiting }}
        </div>
        <div>aguardando</div>
      </template>
      <template v-else>
        <div
          class="display tnum text-secondary"
          style="font-size: 40px; line-height: 44px"
        >
          0
        </div>
        <div>Nenhuma conversa esperando. O bot está atendendo sozinho.</div>
      </template>
      <div class="meta mt-1">
        {{ botActive }} {{ botActive === 1 ? 'conversa ativa' : 'conversas ativas' }} com o bot
      </div>
    </header>
    <v-divider />
    <v-list
      aria-label="Conversas"
      class="pa-0"
    >
      <v-list-item
        v-for="c in sorted"
        :key="c.conversationId"
        :to="{ name: 'inbox', params: { conversationId: c.conversationId } }"
        :active="c.conversationId === selectedId"
        :class="{ 'queue-item--new': newIds.has(c.conversationId) }"
        data-test="queue-item"
        :data-status="c.status"
      >
        <div class="d-flex align-center justify-space-between ga-2">
          <span class="font-weight-medium tnum">{{ c.contact }}</span>
          <v-chip
            v-if="c.status === 'handed_off'"
            class="badge-recado"
            color="accent"
            variant="flat"
            size="x-small"
            data-test="badge-recado"
          >
            aguardando humano
          </v-chip>
          <v-chip
            v-else
            size="x-small"
          >
            bot
          </v-chip>
        </div>
        <div class="d-flex align-center ga-2 mt-1">
          <WaitRing
            v-if="c.handoff"
            :handoff-at="c.handoff.at"
            :now="now"
            :goal-seconds="goalSeconds"
          />
          <v-chip
            v-if="c.handoff"
            size="x-small"
          >
            {{ REASON_LABEL[c.handoff.reason] }}
          </v-chip>
        </div>
        <div
          v-if="c.lastMessage"
          class="meta text-truncate mt-1"
        >
          {{ c.lastMessage.preview }}
        </div>
      </v-list-item>
    </v-list>
  </div>
</template>
