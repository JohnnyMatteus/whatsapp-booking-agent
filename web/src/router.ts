import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [
      { path: '/', redirect: '/conversas' },
      { path: '/conversas/:conversationId?', name: 'inbox', component: () => import('./views/InboxView.vue'), props: true },
      { path: '/metricas', name: 'metrics', component: () => import('./views/MetricsView.vue') },
      { path: '/escopo', name: 'scope', component: () => import('./views/ScopeView.vue') },
    ],
  });
}
