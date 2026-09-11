import { defineConfig } from 'vitest/config';

// Config independiente de Vite (evita heredar root: 'public').
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: false,
  },
});
