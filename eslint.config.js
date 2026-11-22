import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', 'services/saas-mcp-server/', 'services/transcription-worker/'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    // A camada de domínio não conhece framework, rede nem fila (ADR 0001).
    files: ['services/booking-agent/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@langchain/*', 'amqplib', 'ioredis', 'fastify', 'zod', '@modelcontextprotocol/*', '@wba/contracts'], message: 'O domínio não depende de framework nem de contratos externos.' },
            { group: ['**/adapters/**', '**/agent/**', '**/application/**'], message: 'O domínio não depende de camadas externas.' },
          ],
        },
      ],
    },
  },
  {
    files: ['web/**/*.vue'],
    extends: [vue.configs['flat/recommended']],
    languageOptions: {
      globals: { HTMLElement: 'readonly', setInterval: 'readonly', clearInterval: 'readonly' },
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
);
