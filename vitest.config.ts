import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.{ts,tsx}'], environment: 'node',
    // Geometry has real deadlines; avoid starving it with one process per CPU.
    maxWorkers: 2, minWorkers: 1,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
