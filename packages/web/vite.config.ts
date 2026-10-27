import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Server the dev/preview proxy talks to (PA_SERVER=http://127.0.0.1:4350 for the e2e). */
const target = process.env.PA_SERVER ?? 'http://127.0.0.1:4242';
const proxy = { '/api': target, '/events': target, '/plugins': target, '/v1': target };

export default defineConfig({
  server: { port: 5173, proxy },
  preview: { proxy },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo.html'),
        settings: resolve(__dirname, 'settings.html'),
        inspector: resolve(__dirname, 'inspector.html'),
      },
    },
  },
});
