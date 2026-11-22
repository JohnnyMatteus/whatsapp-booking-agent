<script setup lang="ts">
import { mdiChartBox, mdiInbox, mdiShieldCheckOutline } from '@mdi/js';
import { useTenant } from './composables/panel';

const tenantId = useTenant();
const nav = [
  { to: '/conversas', label: 'Conversas', icon: mdiInbox },
  { to: '/metricas', label: 'Métricas', icon: mdiChartBox },
  { to: '/escopo', label: 'Escopo e respostas', icon: mdiShieldCheckOutline },
];
</script>

<template>
  <v-app>
    <v-app-bar>
      <v-app-bar-title class="display">
        Recado <span class="meta ml-2">{{ tenantId }}</span>
      </v-app-bar-title>
      <nav
        class="d-flex ga-1 mr-4"
        aria-label="Seções do painel"
      >
        <v-btn
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          variant="text"
        >
          {{ item.label }}
        </v-btn>
      </nav>
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>
