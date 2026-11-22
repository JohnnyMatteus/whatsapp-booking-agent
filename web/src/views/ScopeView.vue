<script setup lang="ts">
import { REASON_LABEL } from '../lib/labels';
import { useScope } from '../composables/panel';

const scope = useScope();
</script>

<template>
  <v-container
    class="py-6"
    style="max-width: 900px"
  >
    <h1 class="mb-1">
      Escopo e respostas
    </h1>
    <p class="meta mb-6">
      Somente leitura. O escopo é política determinística: o modelo de linguagem não a altera.
    </p>
    <v-alert
      v-if="scope.isError.value"
      type="error"
    >
      Não foi possível carregar a política de escopo.
    </v-alert>
    <template v-else-if="scope.data.value">
      <h2 class="text-h6 mb-2">
        Intenções suportadas
      </h2>
      <v-list
        lines="two"
        class="mb-6"
      >
        <v-list-item
          v-for="i in scope.data.value.intents"
          :key="i.intent"
          :title="i.label"
          :subtitle="i.examples.join(' · ')"
          data-test="intent"
        />
      </v-list>
      <h2 class="text-h6 mb-2">
        Quando o bot passa para uma pessoa
      </h2>
      <v-list
        lines="two"
        class="mb-6"
      >
        <v-list-item
          v-for="t in scope.data.value.handoffTriggers"
          :key="t.reason"
          :title="t.label || REASON_LABEL[t.reason]"
          :subtitle="t.examples.join(' · ')"
        />
      </v-list>
      <h2 class="text-h6 mb-2">
        Fora do escopo
      </h2>
      <ul class="mb-3 pl-5">
        <li
          v-for="e in scope.data.value.outOfScopeExamples"
          :key="e"
        >
          {{ e }}
        </li>
      </ul>
      <v-card
        border
        class="pa-4"
      >
        <div class="meta mb-1">
          Recusa padrão
        </div>
        <p data-test="refusal">
          {{ scope.data.value.refusal }}
        </p>
      </v-card>
    </template>
    <v-progress-linear
      v-else
      indeterminate
    />
  </v-container>
</template>
