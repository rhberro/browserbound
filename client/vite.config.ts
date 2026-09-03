import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [preact(), tailwindcss()],
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
