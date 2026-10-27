// Scene e2e: real server (port 4350) fed by fixtures/claude-code.v1.jsonl + `vite preview` (5350),
// headless system Chrome. Checks 4 agents in 3 offices, a waiting agent with its "!" bubble, takes
// scene-1.png (builders) and scene-2.png (finished town), and the mean frame time with 50 synthetic agents.
// Usage: node packages/web/scripts/scene-check.mjs   (SCENE_NOBUILD=1 to reuse dist/)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const repo = path.resolve(webDir, '..', '..');
const SP = Number(process.env.SCENE_SERVER_PORT ?? 4350);
const WP = Number(process.env.SCENE_WEB_PORT ?? 5350);
const BUDGET_MS = 16;
const N_SYN = 50;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-scene-'));
const fx = JSON.parse(fs.readFileSync(path.join(repo, 'fixtures', 'config.fixtures.json'), 'utf8').replaceAll('__REPO__', repo));
const cfg = {
  ...fx,
  inputs: [...fx.inputs.filter((i) => i.id === 'fx'), { id: 'http', type: 'http', adapter: 'claude-code' }],
  plugins: ['@pixelagents/plugin-claude-code', '@pixelagents/plugin-pop'],
};
fs.writeFileSync(path.join(tmp, 'config.json'), JSON.stringify(cfg));

const procs = [];
const logs = [];
function run(cmd, args, opts) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  p.stdout.on('data', (d) => logs.push(String(d)));
  p.stderr.on('data', (d) => logs.push(String(d)));
  procs.push(p);
  return p;
}
const cleanup = () => {
  for (const p of procs) { try { p.kill('SIGTERM'); } catch { /* gone */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
};
process.on('exit', cleanup);

async function waitUrl(url, what) {
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`${what} did not start:\n${logs.join('').slice(-2000)}`);
}

const post = (lines) => fetch(`http://127.0.0.1:${SP}/v1/events`, { method: 'POST', headers: { 'content-type': 'application/x-ndjson' }, body: lines.map((l) => JSON.stringify(l)).join('\n') })
  .then((r) => { if (!r.ok) throw new Error(`POST /v1/events → ${r.status}`); });

let browser, code = 0;
const results = [];
const check = (name, ok, info) => { results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); if (!ok) code = 1; };

try {
  if (!process.env.SCENE_NOBUILD) {
    const b = spawnSync('npx', ['vite', 'build'], { cwd: webDir, encoding: 'utf8' });
    if (b.status !== 0) throw new Error('vite build failed:\n' + b.stdout + b.stderr);
  }
  run('npx', ['tsx', path.join(repo, 'packages/server/src/cli.ts'), 'serve', '--config', path.join(tmp, 'config.json'), '--data-dir', path.join(tmp, 'data'), '--port', String(SP)], { cwd: repo });
  await waitUrl(`http://127.0.0.1:${SP}/api/state`, 'server');
  run('npx', ['vite', 'preview', '--port', String(WP), '--strictPort', '--host', '127.0.0.1'], { cwd: webDir, env: { ...process.env, PA_SERVER: `http://127.0.0.1:${SP}` } });
  await waitUrl(`http://127.0.0.1:${WP}/`, 'vite preview');

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${WP}/`);
  await page.waitForFunction(() => window.__pixelagents?.scene.actors().length > 0, null, { timeout: 15000 });

  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(here, 'scene-1.png') });
  const building = await page.evaluate(() => !window.__pixelagents.scene.buildDone());
  check('scene-1.png taken during the builders animation', building);

  const agents = await page.evaluate(() => window.__pixelagents.scene.actors().filter((a) => a.kind === 'agent'));
  const groups = await page.evaluate(() => window.__pixelagents.scene.groups());
  const offices = new Set(agents.map((a) => a.group));
  check('4 agents in 3 offices', agents.length === 4 && offices.size === 3 && groups.length === 3, `${agents.length} agents, offices ${[...offices].join(',')}, groups ${groups.join(',')}`);

  await page.waitForFunction(() => window.__pixelagents.scene.buildDone(), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(here, 'scene-2.png') });

  const base = { v: 1, session: 's-laptop-2', agent: 'dev', account: 'work', host: 'laptop', cwd: '/home/dev/code/api', repo: 'api', branch: 'main' };
  await post([{ ...base, ts: new Date().toISOString(), kind: 'waiting.permission', tool: 'Bash', detail: 'npm test' }]);
  const waiting = await page.waitForFunction(() => window.__pixelagents.scene.actors().find((a) => a.behavior === 'wait' && a.bubble === '!' && a.visible), null, { timeout: 8000 })
    .then((h) => h.jsonValue()).catch(() => null);
  check('a waiting agent shows its "!" bubble', !!waiting, waiting ? `${waiting.id} at ${waiting.x},${waiting.y}` : 'none');
  await page.screenshot({ path: path.join(here, 'scene-wait.png') });

  // 50 synthetic agents in 5 offices, all working
  const now = () => new Date().toISOString();
  const lines = [];
  for (let i = 0; i < N_SYN; i++) {
    const b = { v: 1, session: `syn-${i}`, agent: 'dev', account: ['work', 'personal', 'plus'][i % 3], host: `host-${i % 5}`, cwd: `/w/r${i % 3}`, repo: `repo-${i % 3}`, branch: 'main' };
    lines.push({ ...b, ts: now(), kind: 'session.start' }, { ...b, ts: now(), kind: 'turn.start' }, { ...b, ts: now(), kind: 'tool.pre', tool: ['Edit', 'Read', 'Bash', 'WebFetch'][i % 4], detail: `src/f${i}.ts` });
  }
  await post(lines);
  await page.waitForFunction((n) => window.__pixelagents.scene.actors().filter((a) => a.kind === 'agent').length >= n, N_SYN + 4, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__pixelagents.scene.buildDone(), null, { timeout: 40000 });
  await page.waitForTimeout(6000); // arrivals finish
  const perf = await page.evaluate(() => new Promise((res) => {
    const e = window.__pixelagents.engine, ms = [];
    const hook = (_dt, m) => ms.push(m);
    e.onFrame.push(hook);
    setTimeout(() => { e.onFrame.splice(e.onFrame.indexOf(hook), 1); ms.sort((a, b) => a - b); res({ n: ms.length, mean: ms.reduce((s, x) => s + x, 0) / ms.length, p95: ms[Math.floor(ms.length * 0.95)] }); }, 4000);
  }));
  const nAct = await page.evaluate(() => window.__pixelagents.scene.actors().filter((a) => a.visible).length);
  check(`mean frame < ${BUDGET_MS} ms with ${N_SYN} synthetic agents`, perf.mean < BUDGET_MS, `mean ${perf.mean.toFixed(2)} ms, p95 ${perf.p95?.toFixed(2)} ms over ${perf.n} frames, ${nAct} visible actors`);
  await page.screenshot({ path: path.join(here, 'scene-50.png') });
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  await browser?.close();
  console.log(results.join('\n'));
  cleanup();
  process.exit(code);
}
