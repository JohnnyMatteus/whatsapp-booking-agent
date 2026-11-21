<script setup lang="ts">
import HandoffQueueView from './views/HandoffQueueView.vue';

const tenantId = import.meta.env.VITE_TENANT_ID ?? 'estudio-lotus';
</script>

<template>
  <v-app>
    <v-app-bar
      title="Painel do estúdio"
      color="primary"
    />
    <v-main>
      <v-container class="py-6">
        <HandoffQueueView :tenant-id="tenantId" />
      </v-container>
    </v-main>
  </v-app>
</template>
