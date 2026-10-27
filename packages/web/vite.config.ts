import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4242', '/events': 'http://127.0.0.1:4242', '/plugins': 'http://127.0.0.1:4242', '/assets': 'http://127.0.0.1:4242' } },
  build: { outDir: 'dist', target: 'es2022' },
});
