import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  CONFIG_SCHEMA,
  DEFAULT_CONFIG,
  mergeConfig,
  type Adapter,
  type InputConfig,
  type PaConfig,
  type PaEvent,
  type ServerPlugin,
} from '@pixelagents/protocol';
import { Assets, ASSET_NAME, validateAsset } from './assets.js';
import { runCommand, runFile, runHub, runPoll, type InputHost } from './inputs.js';
import { buildRegistry, effectiveConfig, loadPlugins, paAdapter, type LoadedPlugin, type Registry } from './plugins.js';
import { Store } from './store.js';
import { expandHome, isLoopback, parseBodyRecords, safeEqual } from './util.js';

export interface ServerOptions {
  /** Where PUT /api/config writes the user config (atomic). Omit to keep it in memory only. */
  configPath?: string;
  /** Built web app (Vite dist) served with SPA fallback when the folder exists. */
  webRoot?: string;
  /** Overrides config.server.dataDir (default ~/.pixelagents). */
  dataDir?: string;
  /** Overrides config.server.port / host. */
  port?: number;
  host?: string;
  /** Injectable clock. */
  now?: () => Date;
  /** Plugin objects added on top of config.plugins (tests, embedding). */
  plugins?: ServerPlugin[];
  /** ms between 1 s timer ticks; 0 disables the automatic timer (call tick() yourself). Default 1000. */
  tickMs?: number;
  /** Delta batching window. Default 100 (≤ 10 Hz). */
  flushMs?: number;
  /** state.json cadence. Default 30000; 0 disables the periodic snapshot (still saved on close). */
  snapshotMs?: number;
  /** SSE keep-alive. Default 15000. */
  heartbeatMs?: number;
  /** File tail poll interval. Default 250. */
  fileTailMs?: number;
  /** Browser origins allowed by CORS (Vite dev server). */
  corsOrigins?: string[];
  log?: (msg: string) => void;
}

export interface PixelServer {
  listen(): Promise<number>;
  close(): Promise<void>;
  /** Port after listen(). */
  readonly port: number;
  /** Effective config (plugin defaults under the user's). */
  readonly config: PaConfig;
  readonly dataDir: string;
  /** Feed one raw record through an input's adapter, as if the input had produced it. */
  push(inputId: string, raw: unknown): void;
  /** Feed an already normalized event. */
  ingest(ev: PaEvent): void;
  /** Run the timers once now (sleep, linger, forget, plugin.tick). */
  tick(): void;
  /** Classify and broadcast pending changes now. */
  flush(): void;
  /** Write state.json now. */
  save(): Promise<void>;
  /** Classified state now (flushes first). */
  snapshot(): import('@pixelagents/protocol').StateSnapshot;
  /** Same as PUT /api/config. */
  applyConfig(next: PaConfig): Promise<{ ok: true; restartRequired: string[]; warnings: string[] } | { ok: false; errors: ConfigError[] }>;
}

export interface ConfigError {
  path: string;
  message: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const BUILTIN_INPUTS = new Set(['http', 'file', 'command', 'poll', 'hub']);
const MAX_BODY = 8 * 1024 * 1024;
const REDACTED = '***';

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function createServer(config: PaConfig, opts: ServerOptions = {}): PixelServer {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? ((m: string) => console.error(`[pixelagents] ${m}`));
  const flushMs = opts.flushMs ?? 100;
  const tickMs = opts.tickMs ?? 1000;
  const snapshotMs = opts.snapshotMs ?? 30_000;
  const heartbeatMs = opts.heartbeatMs ?? 15_000;
  const corsOrigins = new Set(opts.corsOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173']);

  // Missing top-level sections come from the defaults; sections the caller gives are kept as they are.
  let user: PaConfig = { ...DEFAULT_CONFIG, ...config, server: { ...DEFAULT_CONFIG.server, ...config.server } };
  let loaded: LoadedPlugin[] = [];
  let registry: Registry = buildRegistry([], [paAdapter]);
  let cfg: PaConfig = user;
  let listening = false;
  let boundPort = 0;
  let closed = false;

  const dataDir = path.resolve(expandHome(opts.dataDir ?? user.server.dataDir ?? path.join(os.homedir(), '.pixelagents')));

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(CONFIG_SCHEMA as unknown as object);

  // ---------- state ----------
  let flushTimer: NodeJS.Timeout | null = null;
  const store = new Store({
    config: () => cfg,
    reducers: () => registry.reducers,
    now,
    warn: log,
    onDirty: () => {
      if (flushTimer || closed) return;
      flushTimer = setTimeout(flush, flushMs);
    },
  });

  // ---------- SSE ----------
  const clients = new Set<http.ServerResponse>();
  function sseWrite(res: http.ServerResponse, event: string, data: unknown): void {
    if (res.writableLength > 8 * 1024 * 1024) {
      res.destroy(); // a client that cannot keep up is dropped; it reconnects with a fresh snapshot
      clients.delete(res);
      return;
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  function broadcast(event: string, data: unknown): void {
    if (!clients.size) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      if (res.writableLength > 8 * 1024 * 1024) {
        res.destroy();
        clients.delete(res);
      } else res.write(frame);
    }
  }

  function flush(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    const delta = store.commit();
    if (delta) broadcast('delta', delta);
    void flushLog();
  }

  // ---------- persistence ----------
  let logBuf: string[] = [];
  let logChain: Promise<void> = Promise.resolve();
  function flushLog(): Promise<void> {
    if (!logBuf.length) return logChain;
    const day = now().toISOString().slice(0, 10);
    const text = logBuf.join('');
    logBuf = [];
    logChain = logChain
      .then(async () => {
        await fs.promises.mkdir(path.join(dataDir, 'log'), { recursive: true });
        await fs.promises.appendFile(path.join(dataDir, 'log', `${day}.jsonl`), text);
      })
      .catch((e: Error) => log(`log write failed: ${e.message}`));
    return logChain;
  }

  let saveChain: Promise<void> = Promise.resolve();
  function save(): Promise<void> {
    const body = JSON.stringify(store.dump());
    saveChain = saveChain
      .then(() => atomicWrite(path.join(dataDir, 'state.json'), body))
      .catch((e: Error) => log(`state save failed: ${e.message}`));
    return saveChain;
  }
  async function restore(): Promise<void> {
    try {
      const data = JSON.parse(await fs.promises.readFile(path.join(dataDir, 'state.json'), 'utf8'));
      store.load(data);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') log(`state.json ignored: ${(e as Error).message}`);
    }
  }

  // ---------- events ----------
  function ingest(ev: PaEvent): void {
    if (!ev || typeof ev.entity !== 'string' || !ev.entity || typeof ev.kind !== 'string' || !ev.kind) return;
    let ts = typeof ev.ts === 'string' ? ev.ts : '';
    if (!ts || Number.isNaN(Date.parse(ts))) ts = now().toISOString();
    const norm: PaEvent = { ...ev, ts, source: ev.source || 'unknown' };
    store.ingest(norm);
    logBuf.push(JSON.stringify(norm) + '\n');
  }

  const warned = new Set<string>();
  function ingestRaw(input: { id: string; options?: Record<string, unknown> }, adapterName: string, raw: unknown): void {
    const adapter: Adapter | undefined = registry.adapters.get(adapterName);
    if (!adapter) {
      if (!warned.has(`${input.id}/${adapterName}`)) {
        warned.add(`${input.id}/${adapterName}`);
        log(`input ${input.id}: adapter "${adapterName}" not found (is its plugin loaded?)`);
      }
      return;
    }
    let events: PaEvent[];
    try {
      events = adapter.parse(raw, { input: input.id, options: input.options ?? {}, now });
    } catch (e) {
      log(`adapter ${adapterName} failed: ${(e as Error).message}`);
      return;
    }
    for (const ev of events ?? []) ingest({ ...ev, source: input.id });
  }

  function tick(): void {
    store.tick();
    for (const t of registry.ticks) {
      try {
        const evs = t.tick({ config: cfg, now, get: (id) => store.raw.get(id) }) ?? [];
        for (const ev of evs) ingest({ ...ev, source: ev.source || `plugin:${t.name}` });
      } catch (e) {
        log(`plugin ${t.name} tick failed: ${(e as Error).message}`);
      }
    }
  }

  // ---------- inputs ----------
  interface Running {
    json: string;
    ctrl: AbortController;
  }
  const running = new Map<string, Running>();

  function startInput(ic: InputConfig): void {
    if (ic.enabled === false) return;
    const ctrl = new AbortController();
    running.set(ic.id, { json: JSON.stringify(ic), ctrl });
    if (ic.type === 'http') return; // served by the HTTP handler
    const adapterName = ('adapter' in ic && ic.adapter) || 'pa';
    const host: InputHost = {
      push: (raw) => ingestRaw(ic as { id: string; options?: Record<string, unknown> }, adapterName, raw),
      hubApply: (up, rm, evs) => {
        store.hubApply(ic.id, up, rm, evs);
      },
      hubDrop: () => store.hubDrop(ic.id),
      warn: log,
      signal: ctrl.signal,
      fileTailMs: opts.fileTailMs ?? 250,
    };
    const done = (p: Promise<void> | void): void => {
      Promise.resolve(p).catch((e: Error) => log(`input ${ic.id} stopped: ${e.message}`));
    };
    switch (ic.type) {
      case 'file': return done(runFile(ic, host));
      case 'command': return done(runCommand(ic, host));
      case 'poll': return done(runPoll(ic, host));
      case 'hub': return done(runHub(ic, host));
      default: {
        const factory = registry.inputs.get((ic as { type: string }).type);
        const any = ic as { id: string; type: string };
        if (!factory) return log(`input ${any.id}: unknown type "${any.type}"`);
        done(factory.start(ic as unknown as Record<string, unknown>, host.push, ctrl.signal));
      }
    }
  }

  function stopInput(id: string): void {
    const r = running.get(id);
    if (!r) return;
    r.ctrl.abort();
    running.delete(id);
    store.hubDrop(id);
  }

  function reconcileInputs(restartPluginTypes: boolean): void {
    const wanted = new Map(cfg.inputs.filter((i) => i.enabled !== false).map((i) => [i.id, i]));
    for (const [id, r] of [...running]) {
      const w = wanted.get(id);
      const pluginTyped = w && !BUILTIN_INPUTS.has(w.type);
      if (!w || r.json !== JSON.stringify(w) || (restartPluginTypes && pluginTyped)) stopInput(id);
    }
    for (const [id, ic] of wanted) if (!running.has(id)) startInput(ic);
  }

  // ---------- config ----------
  const assets = new Assets(path.join(dataDir, 'assets'), () => broadcast('assets', assets.list()));

  function redact(c: PaConfig): PaConfig {
    const out = structuredClone(c);
    if (out.server.token) out.server.token = REDACTED;
    for (const i of out.inputs) if (i.type === 'hub' && i.token) i.token = REDACTED;
    return out;
  }
  function unredact(next: PaConfig, old: PaConfig): PaConfig {
    if (next.server?.token === REDACTED) {
      if (old.server.token) next.server.token = old.server.token;
      else delete next.server.token;
    }
    for (const i of next.inputs ?? []) {
      if (i.type === 'hub' && i.token === REDACTED) {
        const prev = old.inputs.find((o) => o.id === i.id);
        if (prev && prev.type === 'hub' && prev.token) i.token = prev.token;
        else delete i.token;
      }
    }
    return next;
  }

  async function setUserConfig(next: PaConfig, writeToDisk: boolean) {
    const prev = user;
    const pluginsChanged = JSON.stringify(next.plugins) !== JSON.stringify(prev.plugins) || loaded.length === 0 && next.plugins.length > 0;
    const warnings: string[] = [];
    if (pluginsChanged || !listening) {
      const res = await loadPlugins(next.plugins, opts.plugins);
      loaded = res.loaded;
      warnings.push(...res.warnings);
      registry = buildRegistry(
        loaded.map((l) => l.plugin),
        [paAdapter],
      );
    }
    user = next;
    cfg = effectiveConfig(user, loaded.map((l) => l.plugin));
    for (const w of warnings) log(w);
    const restartRequired: string[] = [];
    if (listening) {
      if (prev.server.port !== next.server.port && opts.port === undefined) restartRequired.push('server.port');
      if (prev.server.host !== next.server.host && opts.host === undefined) restartRequired.push('server.host');
      if (prev.server.dataDir !== next.server.dataDir && opts.dataDir === undefined) restartRequired.push('server.dataDir');
    }
    assets.setDirs(cfg.assets);
    reconcileInputs(pluginsChanged);
    store.reclassifyAll();
    if (writeToDisk && opts.configPath) await atomicWrite(opts.configPath, JSON.stringify(user, null, 2) + '\n');
    if (listening) {
      flush();
      broadcast('config', redact(cfg));
      broadcast('assets', assets.list());
    }
    return { ok: true as const, restartRequired, warnings };
  }

  function check(next: unknown): ConfigError[] {
    if (validate(next)) {
      const c = next as PaConfig;
      if ((!isLoopback(c.server.host) && !c.server.token)) {
        return [{ path: '/server/token', message: 'a token is required when the host is not loopback' }];
      }
      return [];
    }
    return (validate.errors ?? []).map((e) => ({ path: e.instancePath || '/', message: e.message ?? 'invalid' }));
  }

  async function applyConfig(next: PaConfig) {
    next = unredact(structuredClone(next), user);
    const errors = check(next);
    if (errors.length) return { ok: false as const, errors };
    return setUserConfig(next, true);
  }

  // ---------- HTTP ----------
  function host(): string {
    return opts.host ?? cfg.server.host;
  }
  function authRequired(): boolean {
    return !isLoopback(host()) || !!cfg.server.token;
  }
  function authorized(req: http.IncomingMessage, url: URL): boolean {
    if (!authRequired()) return true;
    const want = cfg.server.token;
    if (!want) return false;
    const h = req.headers.authorization;
    const got = h && /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '') : url.searchParams.get('token');
    return !!got && safeEqual(got, want);
  }
  function requireAuth(req: http.IncomingMessage, url: URL): void {
    if (!authorized(req, url)) throw new HttpError(401, 'unauthorized: Authorization: Bearer <token> required');
  }

  function send(res: http.ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
    const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  }

  function readBody(req: http.IncomingMessage, max = MAX_BODY): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let n = 0;
      req.on('data', (c: Buffer) => {
        n += c.length;
        if (n > max) {
          reject(new HttpError(413, 'body too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function serveFile(res: http.ServerResponse, file: string, method: string): void {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': st.size,
        'cache-control': 'no-cache',
      });
      if (method === 'HEAD') return void res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  }

  function serveStatic(res: http.ServerResponse, pathname: string, method: string): boolean {
    const root = opts.webRoot && path.resolve(opts.webRoot);
    if (!root || !fs.existsSync(root)) return false;
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      return false;
    }
    let file = path.join(root, path.normalize(rel));
    if (file !== root && !file.startsWith(root + path.sep)) return false;
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    } catch {
      /* missing */
    }
    if (!fs.existsSync(file)) {
      if (path.extname(rel)) return false;
      file = path.join(root, 'index.html'); // SPA fallback
      if (!fs.existsSync(file)) return false;
    }
    serveFile(res, file, method);
    return true;
  }

  function pluginList() {
    return loaded.map(({ plugin: p }) => ({
      name: p.name,
      adapters: (p.adapters ?? []).map((a) => a.name),
      reducers: (p.reducers ?? []).map((r) => r.name),
      inputs: (p.inputs ?? []).map((i) => i.type),
      client: p.clientEntry ? `/plugins/${p.name}/client.js` : undefined,
    }));
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const p = url.pathname;

    const origin = req.headers.origin;
    if (origin && corsOrigins.has(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-headers', 'authorization, content-type');
      res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
    }
    if (method === 'OPTIONS') {
      res.writeHead(204);
      return void res.end();
    }

    if (p === '/healthz') return send(res, 200, { ok: true });

    if (p === '/events' && method === 'GET') {
      flush();
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 2000\n\n');
      sseWrite(res, 'snapshot', store.snapshot());
      sseWrite(res, 'config', redact(cfg));
      sseWrite(res, 'assets', assets.list());
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/state' && method === 'GET') {
      flush();
      return send(res, 200, store.snapshot());
    }
    if (p === '/api/config' && method === 'GET') {
      return send(res, 200, redact(url.searchParams.has('effective') ? cfg : user));
    }
    if (p === '/api/config' && method === 'PUT') {
      requireAuth(req, url);
      let body: unknown;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch (e) {
        if (e instanceof HttpError) throw e;
        return send(res, 400, { errors: [{ path: '/', message: 'body is not valid JSON' }] });
      }
      const result = await applyConfig(body as PaConfig);
      return send(res, result.ok ? 200 : 400, result.ok ? result : { errors: result.errors });
    }
    if (p === '/api/schema' && method === 'GET') return send(res, 200, CONFIG_SCHEMA);
    if (p === '/api/plugins' && method === 'GET') return send(res, 200, pluginList());
    if (p === '/api/assets' && method === 'GET') return send(res, 200, assets.list());

    const am = /^\/api\/assets\/([^/]+)$/.exec(p);
    if (am) {
      const name = decodeURIComponent(am[1]!);
      if (method === 'GET' || method === 'HEAD') {
        const file = ASSET_NAME.test(name) ? assets.resolve(name) : null;
        return file ? serveFile(res, file, method) : send(res, 404, { error: 'not found' });
      }
      if (method === 'PUT') {
        requireAuth(req, url);
        if (!ASSET_NAME.test(name)) throw new HttpError(400, 'asset name must be [A-Za-z0-9._-]+ and end in .px.json or .png');
        const body = await readBody(req);
        const bad = validateAsset(name, body);
        if (bad) throw new HttpError(400, bad);
        await assets.save(name, body);
        broadcast('assets', assets.list());
        return send(res, 200, { ok: true, name, size: body.length });
      }
    }

    const pm = /^\/plugins\/(.+)\/client\.js$/.exec(p);
    if (pm && method === 'GET') {
      const entry = registry.clients.get(decodeURIComponent(pm[1]!));
      return entry ? serveFile(res, entry, method) : send(res, 404, { error: 'no client entry for this plugin' });
    }

    if (p === '/v1/events' && method === 'POST') {
      requireAuth(req, url);
      const wantId = url.searchParams.get('input');
      const input = cfg.inputs.find((i) => i.type === 'http' && i.enabled !== false && (!wantId || i.id === wantId));
      if (!input || input.type !== 'http') throw new HttpError(404, 'no enabled http input');
      const adapterName = url.searchParams.get('adapter') || input.adapter || 'pa';
      if (!registry.adapters.has(adapterName)) throw new HttpError(400, `unknown adapter "${adapterName}"`);
      const records = parseBodyRecords((await readBody(req)).toString('utf8'));
      const before = store.size;
      for (const r of records) ingestRaw(input, adapterName, r);
      return send(res, 202, { accepted: records.length, entities: store.size - before });
    }

    if ((method === 'GET' || method === 'HEAD') && !p.startsWith('/api/') && serveStatic(res, p, method)) return;
    send(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e: unknown) => {
      if (res.headersSent) return void res.destroy();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      log(`request failed: ${(e as Error).message}`);
      send(res, 500, { error: 'internal error' });
    });
  });
  server.keepAliveTimeout = 30_000;

  // ---------- lifecycle ----------
  const timers: NodeJS.Timeout[] = [];

  const api: PixelServer = {
    async listen() {
      await fs.promises.mkdir(dataDir, { recursive: true });
      await setUserConfig(user, false);
      await restore();
      reconcileInputs(false);
      store.reclassifyAll();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? cfg.server.port, host(), () => {
          server.off('error', reject);
          resolve();
        });
      });
      listening = true;
      boundPort = (server.address() as { port: number }).port;
      if (!isLoopback(host()) && !cfg.server.token) log('WARNING: non-loopback host without server.token: ingest and PUT are refused');
      if (tickMs > 0) timers.push(setInterval(tick, tickMs));
      if (snapshotMs > 0) timers.push(setInterval(() => void save(), snapshotMs));
      timers.push(
        setInterval(() => {
          for (const c of clients) c.write(': heartbeat\n\n');
        }, heartbeatMs),
      );
      for (const t of timers) t.unref();
      return boundPort;
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const t of timers) clearInterval(t);
      for (const id of [...running.keys()]) stopInput(id);
      assets.close();
      flush();
      for (const c of clients) c.end();
      clients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        if (!listening) resolve();
      });
      await flushLog();
      await save();
    },
    get port() {
      return boundPort;
    },
    get config() {
      return cfg;
    },
    dataDir,
    push(inputId, raw) {
      const ic = cfg.inputs.find((i) => i.id === inputId);
      if (!ic) throw new Error(`no input "${inputId}"`);
      ingestRaw(ic, ('adapter' in ic && ic.adapter) || 'pa', raw);
    },
    ingest,
    tick,
    flush,
    save,
    snapshot() {
      flush();
      return store.snapshot();
    },
    applyConfig,
  };
  return api;
}

async function atomicWrite(file: string, body: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tmp, body);
  await fs.promises.rename(tmp, file);
}
