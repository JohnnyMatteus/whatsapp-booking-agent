<script setup lang="ts">
import { mdiChartBox, mdiInbox, mdiLogout, mdiShieldCheckOutline } from '@mdi/js';
import { canAccess } from './auth/session';
import { useAuth, useSession } from './composables/auth';
import { useTenant } from './composables/panel';

const tenantId = useTenant();
const session = useSession();
const auth = useAuth();
const nav = [
  { to: '/conversas', label: 'Conversas', icon: mdiInbox, role: 'attendant' },
  { to: '/metricas', label: 'Métricas', icon: mdiChartBox, role: 'manager' },
  { to: '/escopo', label: 'Escopo e respostas', icon: mdiShieldCheckOutline, role: 'attendant' },
].filter((item) => !session || canAccess(session, item.role as 'attendant' | 'manager'));
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
      <template v-if="session && auth">
        <span
          class="meta mr-2"
          data-test="user-name"
        >{{ session.name }}</span>
        <v-btn
          :prepend-icon="mdiLogout"
          variant="text"
          data-test="logout"
          @click="auth.logout()"
        >
          Sair
        </v-btn>
      </template>
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>
