// Perf check of the engine demo: 50 actors + 3 filters for 10 s in headless Chrome (system Chrome, no downloads).
// Usage: node packages/web/scripts/perf.mjs   (from the repo root or packages/web)
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const PORT = Number(process.env.PERF_PORT ?? 5310);
const SECONDS = Number(process.env.PERF_SECONDS ?? 10);
const N = Number(process.env.PERF_ACTORS ?? 50);
const BUDGET_MS = 16;

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: webDir, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
vite.stdout.on('data', (d) => (log += d));
vite.stderr.on('data', (d) => (log += d));
const stopVite = () => { try { vite.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stopVite);

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`vite did not start:\n${log}`);
}

let browser;
let code = 0;
try {
  await waitUp();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 984 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/?n=${N}`);
  await page.waitForFunction(() => window.__pa && window.__pa.engine.ecs.size > 0, null, { timeout: 20000 });
  await page.waitForTimeout(3000); // warm-up (shader compile, JIT)
  await page.evaluate(() => {
    const pa = window.__pa;
    pa.hud.stats.reset();
    window.__intervals = [];
    let last = performance.now();
    const loop = (t) => { window.__intervals.push(t - last); last = t; window.__raf = requestAnimationFrame(loop); };
    window.__raf = requestAnimationFrame(loop);
  });
  await page.waitForTimeout(SECONDS * 1000);
  const r = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    const pa = window.__pa, s = pa.hud.stats;
    const iv = [...window.__intervals].slice(1).sort((a, b) => a - b);
    const mean = iv.reduce((a, b) => a + b, 0) / iv.length;
    return {
      backend: pa.engine.backend,
      actors: pa.engine.ecs.size,
      filters: Object.values(pa.engine.layers).reduce((n, l) => n + (l.filters ? l.filters.length : 0), 0),
      frames: iv.length,
      cpuMeanMs: s.cpuMean, cpuP95Ms: s.cpuP95,
      rafMeanMs: mean, rafP95Ms: iv[Math.ceil(iv.length * 0.95) - 1], rafMaxMs: iv[iv.length - 1],
      fps: 1000 / mean,
      drawCalls: pa.engine.drawCalls ?? null,
    };
  });
  await page.screenshot({ path: resolve(here, 'perf.png') });
  console.log(JSON.stringify(r, null, 2));
  if (errors.length) console.log('page errors:', errors.slice(0, 5));
  if (r.actors !== N || r.filters < 3) { console.error(`FAIL: expected ${N} actors and 3 filters`); code = 1; }
  // rAF is vsync-locked (16.67 ms at 60 Hz): the budget is CPU time < 16 ms and no dropped frames (p95 < 20 ms).
  if (r.cpuMeanMs >= BUDGET_MS || r.rafP95Ms >= 20) { console.error('FAIL: frame budget exceeded'); code = 1; }
  if (errors.length) code = 1;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await browser?.close();
  stopVite();
}
process.exit(code);
