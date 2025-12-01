import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  },
  css: {
    // Disable reading root PostCSS config during tests to avoid plugin issues
    // by providing an empty PostCSS config (no plugins)
    postcss: {
      plugins: [],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
