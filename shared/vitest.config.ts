import { defineConfig } from 'vitest/config';

/**
 * `dist/` holds compiled copies of the test files. Without this exclude they
 * run a second time against stale JavaScript, so a source fix looks like it
 * half-worked.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
