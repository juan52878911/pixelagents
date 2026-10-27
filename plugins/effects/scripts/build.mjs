// Bundles the client of the effects plugin into dist/client.js (ESM, no runtime imports:
// pixi comes from globalThis.__pixelagents.pixi, supplied by the host).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function buildClient() {
  await build({
    entryPoints: [resolve(root, 'src/client/index.ts')],
    outfile: resolve(root, 'dist/client.js'),
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    external: ['pixi.js'],
    legalComments: 'none',
    logLevel: 'warning',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildClient();
