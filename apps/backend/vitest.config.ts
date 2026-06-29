import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';
import { resolve } from 'path';

export default defineConfig({
  plugins: [swc.vite()],
  resolve: {
    alias: {
      '@aire/shared': resolve(__dirname, '../../packages/shared/src'),
    },
  },
  test: {
    globals: true,
    root: './',
  },
});
