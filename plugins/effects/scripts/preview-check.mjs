// Visual + perf check of the effects plugin against the real Engine, in system Chrome (no downloads).
// Usage: node plugins/effects/scripts/preview-check.mjs      (PREVIEW_PORT, default 5380)
// Writes plugins/effects/scripts/fx-<name>.png and prints frame times with three filters on.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { buildClient } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repo = resolve(root, '../..');
const PORT = Number(process.env.PREVIEW_PORT ?? 5380);
const BUDGET_MS = 16;

await buildClient();
await build({
  entryPoints: [resolve(root, 'preview/main.ts')],
  outfile: resolve(root, 'preview-dist/main.js'),
  bundle: true, format: 'esm', target: 'es2022', platform: 'browser', logLevel: 'warning',
  tsconfig: resolve(repo, 'packages/web/tsconfig.json'),
});

const files = {
  '/': ['preview.html', 'text/html'],
  '/preview-dist/main.js': ['preview-dist/main.js', 'text/javascript'],
  '/plugins/effects/client.js': ['dist/client.js', 'text/javascript'],
};
const server = createServer(async (req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  try {
    if (url === '/char.px.json') {
      res.setHeader('content-type', 'application/json');
      res.end(await readFile(resolve(repo, 'packages/web/src/engine/test-sprites/char.px.json')));
      return;
    }
    const f = files[url];
    if (!f) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', f[1]);
    res.end(await readFile(resolve(root, f[0])));
  } catch (e) { res.statusCode = 500; res.end(String(e)); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const SHOTS = [
  ...(process.env.DBG ? [['dbg', JSON.parse(process.env.DBG)]] : []),
  ['base', []],
  ['crt', [{ layer: 'frame', filter: 'crt' }]],
  ['daynight', [{ layer: 'world', filter: 'daynight', params: { hour: 22 } }, { layer: 'actors', filter: 'daynight', params: { hour: 22 } }]],
  ['glow', [{ layer: 'world', filter: 'glow' }]],
  ['scanlines', [{ layer: 'frame', filter: 'scanlines' }]],
  ['palette', [{ layer: 'frame', filter: 'palette', params: { palette: 'gameboy' } }]],
  ['outline', [{ layer: 'actors', filter: 'outline' }]],
];
const THREE = [
  { layer: 'world', filter: 'daynight', params: { hour: 21 } },
  { layer: 'world', filter: 'glow' },
  { layer: 'frame', filter: 'crt' },
];

let browser;
let code = 0;
try {
  // CI: Playwright's Chromium with software WebGL (SwiftShader); locally the system Chrome.
  browser = await chromium.launch(process.env.CI
    ? { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
    : { channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 960, height: 656 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().startsWith('Failed to load resource')) errors.push(`${m.type()}: ${m.text()}`); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => window.__fx && window.__fx.engine.ecs.size > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);

  if (process.env.COMPILE_ONLY) {
    // Every filter on every layer it is meant for; a GLSL error shows up as a console error.
    const all = await page.evaluate(() => Object.keys(window.__fx.specs));
    for (const name of all) {
      const layers = await page.evaluate((n) => window.__fx.specs[n].layers, name);
      for (const layer of layers) {
        await page.evaluate(([l, n]) => window.__fx.apply([{ layer: l === 'screen' ? 'frame' : l, filter: n }]), [layer, name]);
        await page.waitForTimeout(150);
      }
      console.log(`compiled ${name}`);
    }
    if (errors.length) { console.error('page errors:\n' + errors.join('\n')); code = 1; }
    await browser.close(); server.close();
    process.exit(code);
  }

  for (const [name, list] of SHOTS) {
    await page.evaluate((l) => window.__fx.apply(l), list);
    await page.waitForTimeout(400);
    const out = resolve(here, `fx-${name}.png`);
    await writeFile(out, await page.screenshot());
    console.log(`shot ${name} -> ${out}`);
  }

  // Cost of a frame: render the scene N times back to back and force a GPU sync (readPixels) each time,
  // so the number is real work, not the 60 Hz vsync cadence. Baseline (no filters) vs three filters.
  const cost = async (list) => {
    await page.evaluate((l) => window.__fx.apply(l), list);
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const e = window.__fx.engine;
      const r = e.app.renderer;
      const gl = r.gl;
      const scene = e.scene, rt = e.rt;
      const times = []; const px = new Uint8Array(4);
      for (let i = 0; i < 20; i++) { e.ecs.update(0.016); r.render({ container: scene, target: rt, clear: true }); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        e.ecs.update(0.016);
        r.render({ container: scene, target: rt, clear: true });
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      return { avg: times.reduce((s, x) => s + x, 0) / times.length, p95: times[Math.floor(times.length * 0.95)] };
    });
  };
  const base = await cost([]);
  const three = await cost(THREE);
  console.log(`frame cost, no filters:        avg=${base.avg.toFixed(2)}ms p95=${base.p95.toFixed(2)}ms`);
  console.log(`frame cost, daynight+glow+crt: avg=${three.avg.toFixed(2)}ms p95=${three.p95.toFixed(2)}ms (budget ${BUDGET_MS} ms)`);
  if (three.p95 > BUDGET_MS) { console.error(`FAIL: frame cost p95 over ${BUDGET_MS} ms`); code = 1; }
  if (errors.length) { console.error('page errors:\n' + errors.join('\n')); code = 1; }
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await browser?.close();
  server.close();
}
process.exit(code);
