// End-to-end check of the settings UI against the REAL server (packages/server, port 4370, temp dir) and Vite (5370).
// In the browser: groups.by → account, upload a sprite, draw one in the editor, enable an effect; then the script
// asserts that GET /api/config and the config file on disk reflect it without restarting the server.
// Screenshots: settings-1.png … next to this script's temp dir (or SETTINGS_SHOTS=<dir>).
// Usage: node packages/web/scripts/settings-check.mjs   (from the repo root; uses system Chrome, downloads nothing)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer as createVite } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const repo = resolve(webDir, '..', '..');
const API = 4370, WEB = 5370;
const shots = resolve(process.env.SETTINGS_SHOTS ?? here);
mkdirSync(shots, { recursive: true });

const tmp = mkdtempSync(join(tmpdir(), 'pa-settings-'));
const cfgPath = join(tmp, 'config.json');
const dataDir = join(tmp, 'data');
const base = JSON.parse(readFileSync(join(repo, 'fixtures', 'config.fixtures.json'), 'utf8').replaceAll('__REPO__', repo));
base.assets = [join(repo, 'assets')]; // show the default sprites in the pickers
writeFileSync(cfgPath, JSON.stringify(base, null, 2));

const checks = [];
const ok = (name, cond, extra = '') => { checks.push({ name, cond: !!cond }); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };

const server = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/cli.ts', 'serve', '--config', cfgPath, '--data-dir', dataDir, '--port', String(API)], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = '';
server.stdout.on('data', (d) => (slog += d)); server.stderr.on('data', (d) => (slog += d));
let vite, browser, code = 0;
const cleanup = async () => { try { await browser?.close(); } catch { /* */ } try { await vite?.close(); } catch { /* */ } try { server.kill('SIGTERM'); } catch { /* */ } };
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* */ } });

const jget = async (p) => (await fetch(`http://127.0.0.1:${API}${p}`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } if (Date.now() - t > ms) return null; await sleep(120); } }

try {
  ok('server up', await until(async () => (await fetch(`http://127.0.0.1:${API}/api/state`)).ok, 20000), slog.slice(-200));
  vite = await createVite({
    root: webDir, configFile: false, logLevel: 'warn',
    server: { port: WEB, strictPort: true, host: '127.0.0.1', proxy: Object.fromEntries(['/api', '/events', '/plugins', '/assets'].map((p) => [p, `http://127.0.0.1:${API}`])) },
  });
  await vite.listen();

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${WEB}/settings.html`);
  const nav = (name) => page.getByRole('button', { name, exact: true }).first().click();
  const save = async () => { await page.locator('#pa-save').click(); await page.waitForFunction(() => /Saved/.test(document.querySelector('.pa-toast')?.textContent ?? ''), null, { timeout: 8000 }); };

  // 1. Sources
  await page.waitForSelector('.pa-field');
  await page.waitForFunction(() => document.querySelectorAll('[data-path^="/inputs/"]').length > 3);
  await page.screenshot({ path: join(shots, 'settings-1.png') });
  ok('sources lists the fixture inputs', (await page.locator('[data-path="/inputs/0/id"] input').inputValue()) === 'fx');
  ok('adapter field offers plugin adapters', (await page.locator('datalist option').count()) > 0);

  // 2. Offices: groups.by → account (the shortcut), with the live preview
  await nav('Offices & rules');
  await page.waitForSelector('.pa-preview .pa-pgroup', { timeout: 10000 });
  const before = await page.locator('.pa-pgroup').count();
  await page.getByRole('button', { name: 'by account' }).click();
  await page.waitForSelector('.pa-preview .pa-pgroup');
  const after = await page.locator('.pa-pgroup').allTextContents();
  ok('preview regroups by account before saving', after.length > 0 && (await jget('/api/config')).groups.by !== '{{labels.account}}', `${before} → ${after.length} offices`);
  // add a rule and watch the preview
  await page.getByRole('button', { name: 'Add rule' }).click();
  await page.locator('input[aria-label="Rule 3 set value for view.skin"]').fill('skin-{{labels.account}}');
  await page.locator('input[aria-label="Rule 3 set value for view.skin"]').dispatchEvent('change');
  await page.waitForSelector('.pa-preview [data-skin^="skin-"]');
  ok('preview shows skins from the draft rule', (await page.locator('.pa-preview [data-skin^="skin-"]').count()) > 0);
  await page.screenshot({ path: join(shots, 'settings-2.png') });
  await save();
  const c1 = await until(async () => { const c = await jget('/api/config'); return c.groups.by === '{{labels.account}}' ? c : null; });
  ok('GET /api/config reflects groups.by=account', c1);
  ok('config file on disk reflects it', JSON.parse(readFileSync(cfgPath, 'utf8')).groups.by === '{{labels.account}}');
  const st = await jget('/api/state');
  ok('server regrouped live entities without restart', st.groups.length > 0 && st.groups.every((g) => !g.id.includes('{{')), st.groups.map((g) => g.id).join(','));

  // 3. Sprites: upload a .px.json, then draw one in the editor
  await nav('Sprites');
  const spriteFile = join(tmp, 'up.sprite.px.json');
  writeFileSync(spriteFile, JSON.stringify({ px: 1, sprites: [{ name: 'up.sprite', w: 4, h: 4, palette: { R: '#e4572e' }, frames: ['RRRR', 'R..R', 'R..R', 'RRRR'].map((r, i, a) => a), fps: 0 }].map((s) => ({ ...s, frames: [['RRRR', 'R..R', 'R..R', 'RRRR']] })) }));
  await page.locator('input[type=file]').setInputFiles(spriteFile);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.waitForSelector('[data-asset="up.sprite.px.json"]', { timeout: 8000 });
  const assets = await jget('/api/assets');
  ok('uploaded sprite listed by GET /api/assets', assets.some((a) => a.name === 'up.sprite.px.json' && a.source === 'upload'));
  ok('uploaded file exists in the data dir', existsSync(join(dataDir, 'assets', 'up.sprite.px.json')));
  await page.getByRole('button', { name: 'Create 16×16' }).click();
  const grid = page.locator('canvas.pa-grid');
  await grid.scrollIntoViewIfNeeded();
  const box = await grid.boundingBox();
  const cell = box.width / 16;
  for (let i = 2; i < 14; i++) { await page.mouse.click(box.x + (i + .5) * cell, box.y + 2.5 * cell); await page.mouse.click(box.x + (i + .5) * cell, box.y + 13.5 * cell); }
  await page.getByRole('button', { name: '+ copy' }).click();
  await page.mouse.click(box.x + 8.5 * cell, box.y + 8.5 * cell);
  await page.getByRole('button', { name: 'Save sprite' }).click();
  await page.waitForFunction(() => /Saved my\.sprite/.test(document.querySelector('[role=status]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  const mine = await until(async () => { const r = await fetch(`http://127.0.0.1:${API}/api/assets/my.sprite.px.json`); return r.ok ? r.json() : null; });
  ok('editor saved a valid PxFile with 2 frames', mine && mine.px === 1 && mine.sprites[0].frames.length === 2 && mine.sprites[0].frames[0].length === 16 && mine.sprites[0].frames[0][2][5] === 'R' && mine.sprites[0].frames[1][8][8] === 'R');
  await page.screenshot({ path: join(shots, 'settings-3.png') });

  // 4. Appearance: add a skin, enable an effect
  await nav('Appearance');
  await page.waitForSelector('.pa-picker .pa-thumb', { timeout: 8000 });
  await page.getByRole('button', { name: 'Add effects' }).click();
  const eff = page.locator('[data-path="/effects/0"]');
  await eff.locator('[data-path="/effects/0/filter"] input').fill('crt');
  await eff.locator('[data-path="/effects/0/filter"] input').dispatchEvent('change');
  await eff.locator('[data-path="/effects/0/layer"] select').selectOption('screen');
  await eff.locator('[data-path="/effects/0/enabled"] input').check();
  await page.locator('input[aria-label="New skin name"]').fill('night');
  await page.getByRole('button', { name: 'Add skin' }).click();
  await page.locator('[data-skin="night"] input[aria-label="hair (H) color"]').first().waitFor().catch(() => {});
  await page.locator('[data-skin="night"] .pa-pick[title="acc.headphones"]').click();
  await page.screenshot({ path: join(shots, 'settings-4.png'), fullPage: false });
  await save();
  const c2 = await until(async () => { const c = await jget('/api/config'); return c.effects?.[0]?.enabled === true ? c : null; });
  ok('GET /api/config reflects the enabled crt effect', c2 && c2.effects[0].filter === 'crt' && c2.effects[0].layer === 'screen');
  ok('skin with accessory saved', c2 && c2.skins.night?.accessory === 'acc.headphones');
  ok('effective config applies it live', (await jget('/api/config?effective')).effects.some((e) => e.filter === 'crt' && e.enabled));
  ok('file on disk has the effect', JSON.parse(readFileSync(cfgPath, 'utf8')).effects?.[0]?.filter === 'crt');

  // 5. Server validation errors by path (Advanced editor, invalid value)
  await nav('Advanced');
  await page.waitForSelector('textarea.pa-big');
  const cfg = JSON.parse(await page.locator('textarea.pa-big').inputValue());
  cfg.world.fps = 5;
  await page.locator('textarea.pa-big').fill(JSON.stringify(cfg, null, 2));
  await page.waitForSelector('.pa-errlist li');
  ok('advanced editor validates against the schema client-side', (await page.locator('.pa-errlist').textContent()).includes('/world/fps'));
  await page.locator('textarea.pa-big').dispatchEvent('change');
  await page.locator('#pa-save').click();
  await page.waitForFunction(() => /Not saved/.test(document.querySelector('.pa-toast')?.textContent ?? ''), null, { timeout: 8000 });
  ok('server 400 shown with its path', (await page.locator('#pa-errors').textContent()).includes('/world/fps'));
  await page.screenshot({ path: join(shots, 'settings-5.png') });
  await page.locator('#pa-revert').click();

  // 6. Conflict: change the server config from outside while the form has unsaved edits
  await nav('Offices & rules');
  await page.waitForSelector('[data-path="/groups/label"] input');
  await page.locator('[data-path="/groups/label"] input').fill('LOCAL {{labels.account}}');
  await page.locator('[data-path="/groups/label"] input').dispatchEvent('change');
  const cur = await jget('/api/config');
  cur.timing.historyMax = 77;
  const put = await fetch(`http://127.0.0.1:${API}/api/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cur) });
  ok('external PUT accepted', put.ok);
  await page.waitForSelector('.pa-banner:not([hidden])', { timeout: 8000 });
  ok('conflict banner appears while editing', true);
  await page.screenshot({ path: join(shots, 'settings-6.png') });
  await page.locator('#pa-overwrite').click();
  const c3 = await until(async () => { const c = await jget('/api/config'); return c.groups.label === 'LOCAL {{labels.account}}' ? c : null; });
  ok('"keep mine" saves my draft over the server\'s newer config', c3);

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await cleanup();
}
const failed = checks.filter((c) => !c.cond);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots in ${shots}. Temp dir ${tmp}`);
process.exit(code || (failed.length ? 1 : 0));
