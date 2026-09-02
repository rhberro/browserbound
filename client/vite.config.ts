import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'ES2020',
    minify: false,
    sourcemap: true,
  },
});
