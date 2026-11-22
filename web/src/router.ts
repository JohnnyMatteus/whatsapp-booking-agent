import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import { canAccess, type Role, type Session } from './auth/session';

declare module 'vue-router' {
  interface RouteMeta {
    /** Papel mínimo; o servidor confere de novo, aqui só se evita a tela que daria 403. */
    role?: Role;
  }
}

export function createAppRouter(history: RouterHistory = createWebHistory(), session: Session | null = null) {
  const router = createRouter({
    history,
    routes: [
      { path: '/', redirect: '/conversas' },
      { path: '/conversas/:conversationId?', name: 'inbox', component: () => import('./views/InboxView.vue'), props: true },
      { path: '/metricas', name: 'metrics', component: () => import('./views/MetricsView.vue'), meta: { role: 'manager' } },
      { path: '/escopo', name: 'scope', component: () => import('./views/ScopeView.vue') },
    ],
  });
  router.beforeEach((to) => (to.meta.role && session && !canAccess(session, to.meta.role) ? { name: 'inbox' } : true));
  return router;
}
