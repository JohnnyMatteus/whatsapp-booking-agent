<script setup lang="ts">
import { mdiRobotHappyOutline, mdiRefresh } from '@mdi/js';
import { computed } from 'vue';
import { REASON_LABELS, waitingTime } from '../api/handoffs';
import { useHandoffQueue } from '../composables/useHandoffQueue';

const props = defineProps<{ tenantId: string }>();
const { queue, resume } = useHandoffQueue(props.tenantId);

const now = computed(() => new Date(queue.dataUpdatedAt.value || Date.now()));
const tickets = computed(() => queue.data.value ?? []);
</script>

<template>
  <v-card>
    <v-card-title class="d-flex align-center">
      Fila de atendimento
      <v-chip
        class="ml-2"
        size="small"
        data-test="count"
      >
        {{ tickets.length }}
      </v-chip>
      <v-spacer />
      <v-btn
        :icon="mdiRefresh"
        variant="text"
        :loading="queue.isFetching.value"
        aria-label="Atualizar"
        @click="queue.refetch()"
      />
    </v-card-title>

    <v-alert
      v-if="queue.isError.value"
      type="error"
      variant="tonal"
      class="ma-4"
      data-test="error"
    >
      Não foi possível carregar a fila. Tentando de novo automaticamente.
    </v-alert>

    <v-list
      v-else-if="tickets.length > 0"
      lines="two"
    >
      <v-list-item
        v-for="ticket in tickets"
        :key="ticket.conversationId"
        data-test="ticket"
        :title="ticket.contact"
        :subtitle="`${REASON_LABELS[ticket.reason]} · ${waitingTime(ticket.requestedAt, now)}`"
      >
        <template #append>
          <v-btn
            :prepend-icon="mdiRobotHappyOutline"
            variant="tonal"
            :loading="resume.isPending.value && resume.variables.value === ticket.conversationId"
            @click="resume.mutate(ticket.conversationId)"
          >
            Devolver ao bot
          </v-btn>
        </template>
      </v-list-item>
    </v-list>

    <v-card-text
      v-else-if="!queue.isPending.value"
      data-test="empty"
    >
      Nenhum aluno aguardando atendimento.
    </v-card-text>
  </v-card>
</template>
