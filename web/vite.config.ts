import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';
import vuetify from 'vite-plugin-vuetify';

// Em desenvolvimento o proxy leva /api ao api-gateway com o Authorization do navegador (o painel não
// guarda token no servidor), e o /config.json do login vem do ambiente (em produção, do nginx).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const oidcConfig = JSON.stringify({
    issuer: env.OIDC_ISSUER ?? 'http://127.0.0.1:8180/realms/wba',
    clientId: env.OIDC_CLIENT_ID ?? 'wba-panel',
  });
  return {
    // autoImport: só os componentes Vuetify usados entram no bundle.
    plugins: [
      vue(),
      vuetify({ autoImport: true }),
      {
        name: 'oidc-config',
        configureServer: (server) => {
          server.middlewares.use('/config.json', (_request, response) => {
            response.setHeader('content-type', 'application/json');
            response.end(oidcConfig);
          });
        },
      },
    ],
    server: {
      port: 5173,
      proxy: { '/api': { target: env.GATEWAY_URL ?? 'http://127.0.0.1:8000', changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.test.ts'],
      server: { deps: { inline: ['vuetify'] } },
      css: false,
      // O primeiro teste paga a importação do Vuetify; com o CI paralelo, 5 s é pouco.
      testTimeout: 20_000,
    },
  };
});
