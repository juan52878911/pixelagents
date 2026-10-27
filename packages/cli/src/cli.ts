// The published `pixelagents` command: serve | demo | doctor | hooks | agent | service.
// Bundled by scripts/build.mjs: server, official plugins and emitter are inside dist/cli.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, type PaConfig, type ServerPlugin } from '@pixelagents/protocol';
import { createServer } from '@pixelagents/server';
import { hooksStatus, runCli as runEmitterCli } from '@pixelagents/emitter';
import claudeCode from '@pixelagents/plugin-claude-code';
import delega from '@pixelagents/plugin-delega';
import effects from '@pixelagents/plugin-effects';
import hostStats from '@pixelagents/plugin-host-stats';
import kindling from '@pixelagents/plugin-kindling';
import map from '@pixelagents/plugin-map';
import nod from '@pixelagents/plugin-nod';
import pop from '@pixelagents/plugin-pop';

/** Plugins that ship inside the bundle, by the package name a config uses to load them. */
const BUNDLED: Record<string, ServerPlugin> = {
  '@pixelagents/plugin-claude-code': claudeCode,
  '@pixelagents/plugin-delega': delega,
  '@pixelagents/plugin-effects': effects,
  '@pixelagents/plugin-host-stats': hostStats,
  '@pixelagents/plugin-kindling': kindling,
  '@pixelagents/plugin-map': map,
  '@pixelagents/plugin-nod': nod,
  '@pixelagents/plugin-pop': pop,
};
// The build rewrites the server's plugin loader to look here before doing a real `import()`.
(globalThis as Record<string, unknown>).__paBundled = BUNDLED;

const USAGE = `usage:
  pixelagents serve [--config FILE] [--port N] [--host H] [--data-dir DIR] [--web DIR]
  pixelagents demo [--port N] [--host H]       replay a sample session (no hooks needed)
  pixelagents doctor [--config FILE] [--config-dir DIR]...
  pixelagents hooks install|uninstall|status [--config-dir DIR]... [--account NAME]
  pixelagents agent --hub URL --token T [--file PATH]... [--dir DIR]
  pixelagents service install|uninstall|print serve|agent [args...]`;

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(here, 'web');
const assetsDir = path.join(here, 'assets');
const demoFile = path.join(here, 'demo.jsonl');

function expandHome(p: string): string {
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

interface Flags {
  v: Record<string, string>;
  multi: Record<string, string[]>;
  bool: Set<string>;
  rest: string[];
}

function parseFlags(argv: string[], valued: string[], multi: string[] = []): Flags {
  const f: Flags = { v: {}, multi: {}, bool: new Set(), rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      f.rest.push(a);
      continue;
    }
    let name = a.slice(2);
    let val: string | undefined;
    const eq = name.indexOf('=');
    if (eq > 0) {
      val = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (valued.includes(name) || multi.includes(name)) {
      val ??= argv[++i];
      if (val === undefined) throw new Error(`--${name} needs a value`);
      if (multi.includes(name)) (f.multi[name] ??= []).push(val);
      else f.v[name] = val;
    } else if (name === 'help' || name === 'h') f.bool.add('help');
    else throw new Error(`unknown option ${a}`);
  }
  return f;
}

function readConfig(configPath: string, create: boolean): PaConfig {
  let user: PaConfig;
  if (fs.existsSync(configPath)) {
    const file = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<PaConfig>;
    user = { ...DEFAULT_CONFIG, ...file, server: { ...DEFAULT_CONFIG.server, ...file.server } } as PaConfig;
  } else {
    if (create) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
      console.error(`[pixelagents] created ${configPath} from the default config`);
    }
    user = structuredClone(DEFAULT_CONFIG);
  }
  return user;
}

/** The default sprites travel inside the package; a user's own asset folders come after and win. */
function withBundledAssets(cfg: PaConfig): PaConfig {
  if (!fs.existsSync(assetsDir) || cfg.assets.includes(assetsDir)) return cfg;
  return { ...cfg, assets: [assetsDir, ...cfg.assets] };
}

function handleSignals(close: () => Promise<void>): void {
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void close().finally(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

async function serve(argv: string[]): Promise<number> {
  const f = parseFlags(argv, ['config', 'port', 'host', 'web', 'data-dir']);
  if (f.bool.has('help') || f.rest.length) {
    console.error(USAGE);
    return f.bool.has('help') ? 0 : 2;
  }
  const configPath = path.resolve(expandHome(f.v.config ?? path.join(os.homedir(), '.pixelagents', 'config.json')));
  const user = withBundledAssets(readConfig(configPath, true));
  const server = createServer(user, {
    configPath,
    webRoot: f.v.web ?? (fs.existsSync(webDir) ? webDir : undefined),
    dataDir: f.v['data-dir'],
    port: f.v.port ? Number(f.v.port) : undefined,
    host: f.v.host,
    log: (m) => console.error(`[pixelagents] ${m}`),
  });
  const port = await server.listen();
  console.error(`[pixelagents] listening on http://${f.v.host ?? user.server.host}:${port}  (config ${configPath}, data ${server.dataDir})`);
  handleSignals(() => server.close());
  await new Promise(() => {});
  return 0;
}

async function demo(argv: string[]): Promise<number> {
  const f = parseFlags(argv, ['port', 'host']);
  if (f.bool.has('help') || f.rest.length) {
    console.error(USAGE);
    return f.bool.has('help') ? 0 : 2;
  }
  const lines = fs.existsSync(demoFile)
    ? fs.readFileSync(demoFile, 'utf8').split('\n').filter(Boolean)
    : [];
  if (!lines.length) throw new Error(`demo data missing (${demoFile})`);
  const records = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelagents-demo-'));
  const cfg = withBundledAssets({
    ...structuredClone(DEFAULT_CONFIG),
    inputs: [{ id: 'demo', type: 'http', adapter: 'claude-code' }],
    timing: { ...DEFAULT_CONFIG.timing, sleepAfterSec: 900, endedLingerSec: 6 },
  });
  const server = createServer(cfg, {
    webRoot: fs.existsSync(webDir) ? webDir : undefined,
    dataDir,
    port: f.v.port ? Number(f.v.port) : undefined,
    host: f.v.host,
    log: (m) => console.error(`[pixelagents] ${m}`),
  });
  const port = await server.listen();
  console.error(`[pixelagents] demo on http://${f.v.host ?? cfg.server.host}:${port}  (sample session in a loop, Ctrl+C to stop)`);

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const play = (i: number, base: number): void => {
    if (stopped) return;
    if (i >= records.length) {
      timer = setTimeout(() => play(0, Date.now()), 4000);
      return;
    }
    const r = records[i]!;
    server.push('demo', { ...r, ts: new Date().toISOString() });
    const gap = i + 1 < records.length ? Date.parse(String(records[i + 1]!.ts)) - Date.parse(String(r.ts)) : 0;
    // The sample spans minutes; compress it so the town stays lively, never faster than 80 ms per event.
    timer = setTimeout(() => play(i + 1, base), Math.min(1500, Math.max(80, gap / 4)));
  };
  play(0, Date.now());
  handleSignals(async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise(() => {});
  return 0;
}

async function get(url: string, ms = 1500): Promise<{ status: number; body: string } | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return { status: r.status, body: await r.text() };
  } catch {
    return null;
  }
}

async function doctor(argv: string[]): Promise<number> {
  const f = parseFlags(argv, ['config'], ['config-dir']);
  let problems = 0;
  const ok = (m: string): void => console.log(`ok    ${m}`);
  const warn = (m: string): void => {
    problems++;
    console.log(`warn  ${m}`);
  };
  const info = (m: string): void => console.log(`      ${m}`);

  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok(`node ${process.versions.node}`);
  else warn(`node ${process.versions.node}: pixelagents needs Node 20 or newer`);

  const dirs = f.multi['config-dir'];
  try {
    for (const s of hooksStatus(dirs)) {
      const where = s.account ? `${s.configDir} (account ${s.account})` : s.configDir;
      if (s.installed && s.emitterExists !== false) ok(`hooks installed in ${where}`);
      else if (s.installed) warn(`hooks in ${where} point to a missing emitter: ${s.emitterPath}. Run: pixelagents hooks install`);
      else warn(`hooks ${s.events.length ? 'partly installed' : 'not installed'} in ${where}. Run: pixelagents hooks install --config-dir ${s.configDir}`);
    }
  } catch (e) {
    warn(`cannot read hooks: ${(e as Error).message}`);
  }

  const configPath = path.resolve(expandHome(f.v.config ?? path.join(os.homedir(), '.pixelagents', 'config.json')));
  let cfg: PaConfig = structuredClone(DEFAULT_CONFIG);
  if (fs.existsSync(configPath)) {
    try {
      cfg = readConfig(configPath, false);
      ok(`config ${configPath}`);
    } catch (e) {
      warn(`config ${configPath} is not valid JSON: ${(e as Error).message}`);
    }
  } else info(`no config at ${configPath}: defaults apply (created on first \`pixelagents serve\`)`);

  const host = cfg.server.host === '0.0.0.0' ? '127.0.0.1' : cfg.server.host;
  const base = `http://${host}:${cfg.server.port}`;
  const health = await get(`${base}/healthz`);
  if (health?.status === 200) ok(`server answers on ${base}`);
  else warn(`nothing answers on ${base}. Run: pixelagents serve`);

  const enabled = cfg.inputs.filter((i) => i.enabled !== false);
  if (!enabled.length) warn('no inputs configured: nothing will ever appear');
  for (const i of enabled) {
    if (i.type === 'file') {
      const p = path.resolve(expandHome(i.path));
      let st: fs.Stats | null = null;
      try {
        st = fs.statSync(p);
      } catch {
        /* missing */
      }
      if (!st) warn(`input ${i.id}: ${p} does not exist yet (hooks write it on the first event)`);
      else {
        const ago = Math.round((Date.now() - st.mtimeMs) / 1000);
        ok(`input ${i.id}: ${p} (${st.size} bytes, last write ${ago < 120 ? `${ago}s` : `${Math.round(ago / 60)} min`} ago)`);
      }
    } else if (i.type === 'hub') ok(`input ${i.id}: hub ${i.url}`);
    else if (i.type === 'http') ok(`input ${i.id}: http (POST ${base}/v1/events)`);
    else ok(`input ${i.id}: ${i.type}`);
  }

  if (health?.status === 200) {
    const st = await get(`${base}/api/state`);
    try {
      const snap = JSON.parse(st?.body ?? '') as { entities?: unknown[]; groups?: unknown[] };
      const n = snap.entities?.length ?? 0;
      if (n > 0) ok(`events are arriving: ${n} entities in ${snap.groups?.length ?? 0} groups`);
      else warn('the server is up but has seen no events yet. Start a Claude Code session (or run `pixelagents demo`)');
    } catch {
      warn('could not read /api/state');
    }
  }
  console.log(problems ? `\n${problems} thing(s) to look at.` : '\nall good.');
  return problems ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
      console.error(USAGE);
      return cmd ? 0 : 2;
    }
    if (cmd === '--version' || cmd === '-v') {
      const pkg = path.join(here, '..', 'package.json');
      console.log(fs.existsSync(pkg) ? (JSON.parse(fs.readFileSync(pkg, 'utf8')) as { version: string }).version : 'dev');
      return 0;
    }
    if (cmd === 'serve') return await serve(rest);
    if (cmd === 'demo') return await demo(rest);
    if (cmd === 'doctor') return await doctor(rest);
    if (cmd === 'hooks' || cmd === 'agent' || cmd === 'service') return await runEmitterCli(argv);
  } catch (e) {
    console.error(`pixelagents: ${(e as Error).message}`);
    return 1;
  }
  console.error(USAGE);
  return 2;
}
