// Smoke test of the published package: npm pack -> install into a temp prefix -> `pixelagents demo`.
// Never touches the real ~/.pixelagents or ~/.claude: HOME and the config dir are temporary too.
// usage: node scripts/smoke-pack.mjs [port=4390]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] ?? 4390);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelagents-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let child;

function fail(msg) {
  console.error(`smoke-pack FAILED: ${msg}`);
  cleanup();
  process.exit(1);
}
function cleanup() {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });
}
async function get(p) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, { signal: AbortSignal.timeout(2000) });
    return { status: r.status, text: await r.text() };
  } catch {
    return null;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. pack
const packDir = path.join(tmp, 'pack');
fs.mkdirSync(packDir);
execFileSync(npm, ['run', 'build', '-w', 'pixelagents'], { cwd: repo, stdio: 'ignore' });
const out = execFileSync(npm, ['pack', '-w', 'pixelagents', '--pack-destination', packDir, '--json'], { cwd: repo, encoding: 'utf8' });
const tarball = path.join(packDir, JSON.parse(out)[0].filename);
console.log(`packed ${path.basename(tarball)} (${Math.round(fs.statSync(tarball).size / 1024)} KiB)`);

// 2. install into a temporary prefix
const prefix = path.join(tmp, 'prefix');
const env = { ...process.env, HOME: path.join(tmp, 'home'), USERPROFILE: path.join(tmp, 'home'), CLAUDE_CONFIG_DIR: path.join(tmp, 'claude') };
fs.mkdirSync(env.HOME, { recursive: true });
execFileSync(npm, ['i', '-g', tarball, '--prefix', prefix, '--no-audit', '--no-fund'], { env, stdio: 'ignore' });
const bin = path.join(prefix, 'bin', 'pixelagents');
if (!fs.existsSync(bin)) fail(`bin not installed at ${bin}`);
const pkgRoot = path.join(prefix, 'lib', 'node_modules', 'pixelagents');

// 3. hooks against a temp config dir
const cfgDir = path.join(tmp, 'claude');
execFileSync(bin, ['hooks', 'install', '--config-dir', cfgDir], { env });
const status = execFileSync(bin, ['hooks', 'status', '--config-dir', cfgDir], { env, encoding: 'utf8' });
if (!/^installed:/.test(status)) fail(`hooks status: ${status}`);
const emit = path.join(pkgRoot, 'bin', 'emit.js');
if (!fs.existsSync(emit) || !fs.readFileSync(path.join(cfgDir, 'settings.json'), 'utf8').includes(emit.replaceAll('\\', '\\\\'))) fail('hooks do not point at the packaged emit.js');
console.log('hooks install/status ok');

// 4. demo
child = spawn(bin, ['demo', '--port', String(port)], { env, stdio: ['ignore', 'ignore', 'pipe'] });
let log = '';
child.stderr.on('data', (d) => (log += d));
let health = null;
for (let i = 0; i < 40 && !health; i++) {
  await sleep(250);
  if (child.exitCode !== null) fail(`demo exited early:\n${log}`);
  const r = await get('/healthz');
  if (r?.status === 200) health = r;
}
if (!health) fail(`/healthz did not answer:\n${log}`);
const root = await get('/');
if (!root || root.status !== 200 || !/<div id="app">/.test(root.text)) fail('GET / did not serve the web app');
let entities = 0;
for (let i = 0; i < 40 && entities < 2; i++) {
  await sleep(250);
  const s = await get('/api/state');
  if (s?.status === 200) entities = JSON.parse(s.text).entities.length;
}
if (entities < 2) fail(`demo produced ${entities} entities`);
const sprites = await get('/api/assets');
if (!sprites || JSON.parse(sprites.text).length < 1) fail('bundled sprites are not served by /api/assets');
console.log(`demo ok on :${port}: /healthz, /, ${entities} entities, bundled assets`);

const doc = spawnSync(bin, ['doctor', '--config-dir', cfgDir, '--config', path.join(tmp, 'none.json')], { env, encoding: "utf8" }).stdout;
if (!/server answers/.test(doc) && !/nothing answers/.test(doc)) fail(`doctor output unexpected:\n${doc}`);
console.log('doctor ok');

cleanup();
console.log('smoke-pack OK');
