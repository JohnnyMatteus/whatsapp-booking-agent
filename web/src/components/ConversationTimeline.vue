<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { TimelineEntry } from '../api/schemas';
import { ACTION_LABEL, REJECTION_LABEL, TEMPLATE_LABEL } from '../lib/labels';
import { clock } from '../lib/time';
import BotMonogram from './BotMonogram.vue';
import MediaThumbnail from './MediaThumbnail.vue';
import HandoffSeam from './signature/HandoffSeam.vue';
import SourceStamp from './signature/SourceStamp.vue';

const props = defineProps<{ entries: readonly TimelineEntry[] }>();
const scroller = ref<HTMLElement | null>(null);
const count = computed(() => props.entries.length);

// Acompanha a última mensagem sem puxar a tela quando nada chegou.
watch(count, async () => {
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
}, { immediate: true, flush: 'post' });
</script>

<template>
  <div
    ref="scroller"
    class="timeline pa-4"
    data-test="timeline"
    aria-label="Linha do tempo da conversa"
    role="log"
  >
    <template
      v-for="(entry, index) in entries"
      :key="entry.id"
    >
      <HandoffSeam
        v-if="entry.kind === 'handoff'"
        kind="handoff"
        :at="entry.at"
        :reason="entry.reason"
      />
      <HandoffSeam
        v-else-if="entry.kind === 'resumed'"
        kind="resumed"
        :at="entry.at"
      />

      <!-- trilha do aluno: à esquerda, em superfície neutra -->
      <div
        v-else-if="entry.kind === 'student'"
        class="lane lane--student"
        :class="{ 'mt-5': entries[index - 1]?.kind !== 'student' && index > 0 }"
        data-test="entry-student"
      >
        <div class="meta mb-1">
          Aluno · {{ clock(entry.at) }}
        </div>
        <div class="bubble bubble--student">
          <template v-if="entry.action">
            <v-chip
              size="x-small"
              class="mr-2"
            >
              {{ ACTION_LABEL[entry.action.action] }}
            </v-chip>
          </template>
          <details
            v-if="entry.transcribed"
            open
          >
            <summary class="meta">
              áudio · transcrito localmente
            </summary>
            {{ entry.text }}
          </details>
          <template v-else>
            {{ entry.text }}
          </template>
          <MediaThumbnail
            v-if="entry.media?.hasThumbnail"
            :message-id="entry.messageId"
          />
          <v-chip
            v-if="entry.media?.status === 'rejected'"
            size="x-small"
            color="warning"
            class="mt-2"
            data-test="media-rejected"
          >
            mídia recusada · {{ REJECTION_LABEL[entry.media.rejectionReason ?? ''] ?? 'motivo desconhecido' }}
          </v-chip>
        </div>
      </div>

      <!-- trilha do bot: recuada 24 px, barra lateral ardósia -->
      <div
        v-else-if="entry.kind === 'bot' || entry.kind === 'template'"
        class="lane lane--bot mt-2"
        data-test="entry-bot"
      >
        <div class="meta mb-1 d-flex align-center ga-2">
          <BotMonogram />
          <span>Bot · {{ clock(entry.at) }}</span>
          <v-chip
            v-if="entry.kind === 'template'"
            size="x-small"
          >
            template · {{ TEMPLATE_LABEL[entry.template] }}
          </v-chip>
          <v-chip
            v-if="entry.kind === 'bot' && entry.outcome === 'refused'"
            size="x-small"
            color="warning"
            data-test="out-of-scope"
          >
            fora do escopo
          </v-chip>
        </div>
        <div class="bubble bubble--bot">
          {{ entry.text }}
          <ul
            v-if="entry.kind === 'bot' && entry.choices.length > 0"
            class="choices meta mt-2"
          >
            <li
              v-for="choice in entry.choices"
              :key="choice.targetId + choice.action"
            >
              {{ choice.title }}<template v-if="choice.description">
                · {{ choice.description }}
              </template>
            </li>
          </ul>
        </div>
        <SourceStamp
          class="mt-1"
          :citations="entry.citations"
        />
      </div>

      <!-- trilha do atendente: à direita, barra cobalto -->
      <div
        v-else
        class="lane lane--human mt-2"
        data-test="entry-attendant"
      >
        <div class="meta mb-1 text-right">
          Equipe · {{ clock(entry.at) }}
        </div>
        <div class="bubble bubble--human">
          {{ entry.text }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.timeline { flex: 1; overflow: auto; }
.lane { max-width: 640px; }
.lane--student { margin-right: auto; }
.lane--bot { margin-left: 24px; margin-right: auto; }
.lane--human { margin-left: auto; }
.bubble { padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.bubble--student { background: rgb(var(--v-theme-surface-variant)); }
.bubble--bot { background: rgb(var(--v-theme-surface)); border-left: 3px solid rgb(var(--v-theme-lane-bot)); border-radius: 4px 12px 12px 4px; }
.bubble--human { background: rgb(var(--v-theme-surface)); border-right: 3px solid rgb(var(--v-theme-lane-human)); border-radius: 12px 4px 4px 12px; text-align: right; }
.choices { padding-left: 16px; }
</style>
