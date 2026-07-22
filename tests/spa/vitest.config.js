import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'md-loader',
      transform(code, id) {
        if (id.endsWith('.md')) return `export default ${JSON.stringify(code)}`;
      },
    },
  ],
  define: {
    __APP_VERSION__: '"test-build"',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./setup.js'],
    include: ['**/*.test.{js,tsx}'],
    exclude: ['node_modules'],
    // JSX support for .tsx test files (vitest uses esbuild internally)
    esbuild: {
      jsx: 'automatic',
    },
  },
  resolve: {
    alias: {
      // Map the spa module paths so imports in source work under test
      '/js/': new URL('../../spa/js/', import.meta.url).pathname,
    },
  },
});
