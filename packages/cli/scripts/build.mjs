// Builds the publishable package: dist/cli.js (server + official plugins + emitter), dist/web, dist/assets,
// dist/demo.jsonl and bin/emit.js (copied as is, still dependency free).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(pkg, '..', '..');
const dist = path.join(pkg, 'dist');

// 1. The web app (Vite).
const vite = path.join(repo, 'node_modules', 'vite', 'bin', 'vite.js');
execFileSync(process.execPath, [vite, 'build'], { cwd: path.join(repo, 'packages', 'web'), stdio: 'inherit' });

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(path.join(repo, 'packages', 'web', 'dist'), path.join(dist, 'web'), { recursive: true });
fs.cpSync(path.join(repo, 'assets'), path.join(dist, 'assets'), {
  recursive: true,
  filter: (src) => !src.endsWith('.png') || !src.includes('contact-sheet'),
});
fs.copyFileSync(path.join(repo, 'fixtures', 'claude-code.v1.jsonl'), path.join(dist, 'demo.jsonl'));

// 2. The emitter hook: plain JS, no dependencies, referenced by installed hooks as <package>/bin/emit.js.
fs.copyFileSync(path.join(repo, 'packages', 'emitter', 'bin', 'emit.js'), path.join(pkg, 'bin', 'emit.js'));

// 3. The CLI bundle. The server loads plugins with a dynamic import of a package name, which cannot resolve
// inside a bundle; the build makes it look into the plugins bundled by src/cli.ts first.
const LOADER = 'const mod = (await import(/* @vite-ignore */ target)) as Record<string, unknown>;';
const bundledPlugins = {
  name: 'bundled-plugins',
  setup(b) {
    b.onLoad({ filter: /packages[\\/]server[\\/]src[\\/]plugins\.ts$/ }, (args) => {
      const src = fs.readFileSync(args.path, 'utf8');
      if (!src.includes(LOADER)) throw new Error('packages/server/src/plugins.ts changed: update the loader patch in packages/cli/scripts/build.mjs');
      const patched = src.replace(
        LOADER,
        'const mod = ((globalThis as any).__paBundled?.[spec] ? { default: (globalThis as any).__paBundled[spec] } : await import(/* @vite-ignore */ target)) as Record<string, unknown>;',
      );
      return { contents: patched, loader: 'ts' };
    });
  },
};

await build({
  entryPoints: [path.join(pkg, 'src', 'cli.ts')],
  outfile: path.join(dist, 'cli.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [bundledPlugins],
  logLevel: 'info',
});
console.error(`built ${path.relative(repo, dist)}`);
