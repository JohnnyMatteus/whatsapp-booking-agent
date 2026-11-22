<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiError } from '../api/client';
import ContextPanel from '../components/ContextPanel.vue';
import ConversationTimeline from '../components/ConversationTimeline.vue';
import QueueList from '../components/QueueList.vue';
import { useAttendantActions, useConversation, useConversations, useMetrics } from '../composables/panel';
import { ERROR_MESSAGES } from '../lib/labels';
import { clock } from '../lib/time';

const props = defineProps<{ conversationId?: string }>();
const list = useConversations();
const detail = useConversation(() => props.conversationId);
const metrics = useMetrics(7);
const { send, resume } = useAttendantActions(() => props.conversationId);

const goalSeconds = computed(() => metrics.data.value?.goals.avgWaitSeconds ?? 300);
const draft = ref('');
const error = ref<string | null>(null);

// Conversas que entraram na fila depois da primeira carga deslizam e pulsam uma vez.
const seen = new Set<string>();
const newIds = ref<ReadonlySet<string>>(new Set());
watch(
  () => list.data.value,
  (data) => {
    if (!data) return;
    const fresh = data.data.filter((c) => c.status === 'handed_off' && !seen.has(c.conversationId) && seen.size > 0).map((c) => c.conversationId);
    for (const c of data.data) seen.add(c.conversationId);
    newIds.value = new Set(fresh);
  },
  { immediate: true },
);

function messageOf(e: unknown): string {
  return e instanceof ApiError && e.code ? (ERROR_MESSAGES[e.code] ?? e.message) : e instanceof Error ? e.message : 'Algo deu errado.';
}

async function submit(): Promise<void> {
  const text = draft.value.trim();
  if (!text) return;
  error.value = null;
  try {
    await send.mutateAsync(text);
    draft.value = '';
  } catch (e) {
    error.value = messageOf(e);
  }
}

async function giveBack(): Promise<void> {
  error.value = null;
  try {
    await resume.mutateAsync();
  } catch (e) {
    error.value = messageOf(e);
  }
}

const canReply = computed(() => detail.data.value?.status === 'handed_off');
</script>

<template>
  <div
    class="panels"
    :data-selected="Boolean(conversationId)"
  >
    <section
      class="queue"
      aria-label="Fila de atendimento"
    >
      <v-alert
        v-if="list.isError.value"
        type="error"
        class="ma-3"
        data-test="list-error"
      >
        Não foi possível carregar as conversas.
      </v-alert>
      <QueueList
        v-else-if="list.data.value"
        :conversations="list.data.value.data"
        :waiting="list.data.value.meta.waiting"
        :bot-active="list.data.value.meta.botActive"
        :selected-id="conversationId"
        :goal-seconds="goalSeconds"
        :new-ids="newIds"
      />
      <v-progress-linear
        v-else
        indeterminate
      />
    </section>

    <section class="conversation">
      <div
        v-if="!conversationId"
        class="pa-8 text-secondary"
        data-test="no-selection"
      >
        Escolha uma conversa na fila para ler o contexto e responder.
      </div>
      <v-alert
        v-else-if="detail.isError.value"
        type="error"
        class="ma-4"
      >
        Conversa não encontrada.
      </v-alert>
      <template v-else-if="detail.data.value">
        <header class="pa-4 d-flex align-center justify-space-between ga-3 bg-surface">
          <div>
            <h1 class="text-h6 tnum">
              {{ detail.data.value.contact }}
            </h1>
            <div class="meta">
              {{ detail.data.value.status === 'handed_off' ? 'transferida' : 'com o bot' }}
              <template v-if="detail.data.value.serviceWindowEndsAt">
                · janela de resposta até {{ clock(detail.data.value.serviceWindowEndsAt) }}
              </template>
            </div>
          </div>
          <code
            v-if="detail.data.value.correlationId"
            class="meta"
            data-test="correlation-id"
          >{{ detail.data.value.correlationId }}</code>
        </header>
        <ConversationTimeline :entries="detail.data.value.timeline" />
        <form
          class="pa-3 d-flex ga-2 bg-surface"
          data-test="composer"
          @submit.prevent="submit"
        >
          <v-text-field
            v-model="draft"
            :disabled="!canReply"
            :placeholder="canReply ? 'Responder ao aluno' : 'Disponível depois da transferência'"
            aria-label="Mensagem para o aluno"
            hide-details
          />
          <v-btn
            type="submit"
            color="primary"
            :disabled="!canReply || !draft.trim()"
            :loading="send.isPending.value"
          >
            Enviar
          </v-btn>
        </form>
        <v-alert
          v-if="error"
          type="error"
          density="compact"
          data-test="action-error"
        >
          {{ error }}
        </v-alert>
      </template>
      <v-progress-linear
        v-else
        indeterminate
      />
    </section>

    <section
      v-if="detail.data.value"
      class="context"
      aria-label="Contexto"
    >
      <ContextPanel
        :detail="detail.data.value"
        :resuming="resume.isPending.value"
        @resume="giveBack"
      />
    </section>
  </div>
</template>
