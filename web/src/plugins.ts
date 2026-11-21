import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import type { App } from 'vue';
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';

export function installPlugins(app: App, queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })): void {
  app.use(createVuetify({ icons: { defaultSet: 'mdi', aliases, sets: { mdi } } }));
  app.use(VueQueryPlugin, { queryClient });
}
