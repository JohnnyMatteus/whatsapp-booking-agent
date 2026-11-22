<script setup lang="ts">
import { ref } from 'vue';
import type { ConversationDetail } from '../api/schemas';
import { slotTime, clock } from '../lib/time';

defineProps<{ detail: ConversationDetail; resuming: boolean }>();
const emit = defineEmits<{ resume: [] }>();
const confirming = ref(false);

function confirm(): void {
  confirming.value = false;
  emit('resume');
}
</script>

<template>
  <div class="pa-4">
    <h2 class="text-subtitle-1 mb-2">
      Contexto do aluno
    </h2>
    <p
      v-if="detail.context.linked === false"
      class="meta mb-3"
      data-test="not-linked"
    >
      Telefone ainda não vinculado a um aluno.
    </p>

    <h3 class="text-subtitle-2 mt-3">
      Próximas reservas
    </h3>
    <p
      v-if="detail.context.bookings.length === 0"
      class="meta"
    >
      Nenhuma reserva consultada.
    </p>
    <ul class="pa-0 ma-0">
      <li
        v-for="b in detail.context.bookings"
        :key="b.bookingId"
        class="mb-2"
        style="list-style: none"
        data-test="booking"
      >
        <div>{{ b.title }}</div>
        <div class="meta">
          {{ slotTime(b.startsAt, b.timezone) }} · {{ b.status === 'confirmed' ? 'confirmada' : 'lista de espera' }} · consultada às {{ clock(b.fetchedAt) }}
        </div>
      </li>
    </ul>

    <h3 class="text-subtitle-2 mt-3">
      Horários oferecidos pelo bot
    </h3>
    <p
      v-if="detail.context.offeredSlots.length === 0"
      class="meta"
    >
      Nada oferecido ainda.
    </p>
    <ul class="pa-0 ma-0">
      <li
        v-for="s in detail.context.offeredSlots"
        :key="s.sessionId"
        class="mb-2"
        style="list-style: none"
      >
        <div>{{ s.title }}</div>
        <div class="meta">
          {{ slotTime(s.startsAt, s.timezone) }} · {{ s.confirmedCount }}/{{ s.capacity }} vagas
        </div>
      </li>
    </ul>

    <v-divider class="my-4" />
    <template v-if="detail.status === 'handed_off'">
      <v-btn
        v-if="!confirming"
        block
        color="primary"
        data-test="resume"
        :loading="resuming"
        @click="confirming = true"
      >
        Devolver ao bot
      </v-btn>
      <div
        v-else
        data-test="resume-confirm"
      >
        <p class="mb-2">
          O bot volta a responder e o aluno recebe um aviso. Devolver agora?
        </p>
        <div class="d-flex ga-2">
          <v-btn
            color="primary"
            data-test="resume-yes"
            @click="confirm"
          >
            Devolver
          </v-btn>
          <v-btn
            variant="text"
            @click="confirming = false"
          >
            Cancelar
          </v-btn>
        </div>
      </div>
    </template>
    <p
      v-else
      class="meta"
    >
      A conversa está com o bot.
    </p>
  </div>
</template>
