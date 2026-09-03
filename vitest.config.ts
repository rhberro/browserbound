import { defineConfig } from 'vitest/config';

/**
 * Running vitest from the repo root delegates to each package's own config
 * rather than globbing the tree. Globbing picks up the compiled CommonJS
 * copies under each `dist/`, which run a second time against stale JavaScript
 * and make a source fix look like it half-worked.
 */
export default defineConfig({
  test: {
    projects: ['shared', 'server'],
  },
});
