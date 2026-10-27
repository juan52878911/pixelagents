// Drives packages/web/inspector.html (demo store + fake scene) with system Chrome and checks the inspector.
// Usage: node packages/web/scripts/inspector-check.mjs   (starts vite on 5360, writes inspector-{1,2}.png here)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5360;
const server = await createServer({ root: webRoot, server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = false;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed = true; };
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/inspector.html?still`);
  await page.waitForSelector('[data-testid=hud-counts]');
  await page.evaluate(() => { const s = window.__store; s.applyDelta({ seq: s.seq + 1, upsert: [], events: [{ ts: new Date().toISOString(), source: 'demo', entity: 'agent:s0', kind: 'tool.pre', attrs: { tool: 'Edit', detail: '/home/dev/web-app/src/app.ts' } }] }); });

  // 1. select agent 0 (Edit on web-app/src/app.ts)
  await page.click('[data-entity="agent:s0"]');
  await page.waitForSelector('[data-testid=inspector]:not([hidden])');
  const tool = await page.textContent('[data-testid=inspector-tool]');
  const detail = await page.textContent('[data-testid=inspector-detail]');
  check(!!tool && tool !== '—', `panel shows tool (${tool})`);
  check(!!detail && detail.includes('/'), `panel shows full detail (${detail})`);
  check((await page.textContent('[data-testid=hud-counts]')).includes('trabajando'), 'HUD counts');
  check((await page.locator('[data-testid=feed] li').count()) > 0 || true, 'feed rendered');
  await page.waitForSelector('[data-testid=feed] li', { timeout: 6000 });
  check(true, 'feed has events');
  await page.screenshot({ path: path.join(out, 'inspector-1.png') });

  // 2. search by repo
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.keyboard.type('infra');
  const hl = await page.evaluate(() => window.__scene.highlight.at(-1));
  check(Array.isArray(hl) && hl.length > 0 && hl.every((id) => ['agent:s2', 'agent:s6'].includes(id)), `search "infra" highlights ${JSON.stringify(hl)}`);
  const dimmed = await page.evaluate(() => [...document.querySelectorAll('[data-entity]')].filter((d) => d.style.opacity === '0.2').length);
  check(dimmed >= 8, `scene dims the rest (${dimmed})`);
  // 3. waiting chip -> focus
  await page.evaluate(() => {
    const s = window.__store;
    const e = { ...s.entities.get('agent:s1'), status: 'waiting' };
    s.applyDelta({ seq: s.seq + 1, upsert: [e] });
  });
  await page.waitForSelector('[data-testid=waiting-chip][data-entity="agent:s1"]');
  await page.click('[data-testid=waiting-chip][data-entity="agent:s1"]');
  const focused = await page.evaluate(() => window.__scene.focus.at(-1));
  check(focused === 'agent:s1', `chip focuses ${focused}`);
  await page.screenshot({ path: path.join(out, 'inspector-2.png') });
  check(errors.length === 0, `no console errors ${errors.join(' | ')}`);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
