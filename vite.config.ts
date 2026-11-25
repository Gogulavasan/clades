/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/**
 * The ONE place the deploy sub-path is set (GitHub Pages serves the repo at /<repo>/).
 * Override without editing code: CLADES_BASE=/ npm run build  (user site or custom domain).
 */
const BASE_PATH = process.env.CLADES_BASE ?? '/clades/';

export default defineConfig({
  base: BASE_PATH,
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
