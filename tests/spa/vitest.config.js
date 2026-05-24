import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./setup.js'],
    include: ['**/*.test.js'],
    exclude: ['node_modules'],
  },
  resolve: {
    alias: {
      // Map the spa module paths so imports in source work under test
      '/js/': new URL('../../spa/js/', import.meta.url).pathname,
    },
  },
});
