import { defineConfig } from 'vitest/config';

// Só no CI: sobe Redis, RabbitMQ e WireMock com testcontainers.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
