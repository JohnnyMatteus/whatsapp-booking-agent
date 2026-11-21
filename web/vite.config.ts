import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';
import vuetify from 'vite-plugin-vuetify';

// Em desenvolvimento o proxy injeta o token da API do painel do lado do servidor:
// o token nunca vai para o bundle do navegador (em produção, o nginx faz o mesmo).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // autoImport: só os componentes Vuetify usados entram no bundle.
    plugins: [vue(), vuetify({ autoImport: true })],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.BOOKING_AGENT_URL ?? 'http://localhost:8081',
          changeOrigin: true,
          headers: { authorization: `Bearer ${env.PANEL_API_TOKEN ?? ''}` },
        },
      },
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
