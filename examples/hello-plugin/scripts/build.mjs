import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [resolve(root, 'src/client/index.ts')],
  outfile: resolve(root, 'dist/client.js'),
  bundle: true, format: 'esm', target: 'es2022', platform: 'browser', external: ['pixi.js'], logLevel: 'warning',
});
