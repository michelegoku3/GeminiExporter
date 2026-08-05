import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    globals: false,
    coverage: {
      include: ['src/**/*.js'],
      // Il codice di collegamento (loader, composition root, popup) non ha
      // logica propria: si verifica manualmente, non con la coverage.
      exclude: ['src/extension/content/loader.js', 'src/extension/popup/**'],
    },
  },
});
