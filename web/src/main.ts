import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/onest';
import 'vuetify/styles';
import './styles/main.css';
import { createApp } from 'vue';
import App from './App.vue';
import { createPanelApi } from './api/client';
import { createOidcClient, loadOidcConfig } from './auth/oidc';
import { authenticatedFetcher, establishSession } from './auth/session';
import { AUTH_CLIENT, AUTH_SESSION } from './composables/auth';
import { PANEL_API, TENANT_ID } from './composables/panel';
import { installPlugins } from './plugins';
import { createAppRouter } from './router';

const auth = createOidcClient(await loadOidcConfig(), window.location.origin);
const session = await establishSession(auth, {
  path: window.location.pathname + window.location.search,
  replace: (path) => window.history.replaceState(null, '', path),
});

// Sem sessão o navegador já foi para o login: nada é montado.
if (session) {
  const app = createApp(App);
  app.provide(AUTH_CLIENT, auth);
  app.provide(AUTH_SESSION, session);
  app.provide(TENANT_ID, session.tenantId);
  app.provide(PANEL_API, createPanelApi(session.tenantId, authenticatedFetcher(auth, () => window.location.pathname)));
  installPlugins(app, createAppRouter(undefined, session));
  app.mount('#app');
}
