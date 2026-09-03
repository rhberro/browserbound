import { defineConfig } from 'vitest/config';

/**
 * The client's testable surface is its presentation logic — the timing and
 * interpolation modules under `src/rendering`, which are plain TypeScript with
 * no Pixi or DOM in them. Rendering itself is not unit tested here.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
