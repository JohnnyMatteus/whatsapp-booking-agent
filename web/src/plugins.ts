import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import type { App } from 'vue';
import type { Router } from 'vue-router';
import { createRecadoVuetify } from './theme';

export function installPlugins(app: App, router: Router, queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })): void {
  app.use(createRecadoVuetify());
  app.use(VueQueryPlugin, { queryClient });
  app.use(router);
}
