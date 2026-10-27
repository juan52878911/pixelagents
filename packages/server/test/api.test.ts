import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA } from '@pixelagents/protocol';
import { ev, post, sse, start, stopAll, tmp, waitFor } from './helpers.js';

afterEach(stopAll);

const put = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'PUT', body: typeof body === 'string' ? body : Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body), headers });

describe('read endpoints', () => {
  it('serves healthz, schema, state, config, plugins and assets', async () => {
    const c = await start(4312);
    expect((await (await fetch(`${c.url}/healthz`)).json() as any).ok).toBe(true);
    expect(await (await fetch(`${c.url}/api/schema`)).json() as any).toEqual(JSON.parse(JSON.stringify(CONFIG_SCHEMA)));
    const state = await (await fetch(`${c.url}/api/state`)).json() as any;
    expect(state).toMatchObject({ protocol: 1, entities: [], groups: [] });
    expect((await (await fetch(`${c.url}/api/config`)).json() as any).version).toBe(1);
    expect(await (await fetch(`${c.url}/api/plugins`)).json() as any).toEqual([]);
    expect(await (await fetch(`${c.url}/api/assets`)).json() as any).toEqual([]);
    expect((await fetch(`${c.url}/nope`)).status).toBe(404);
  });
});

describe('SSE', () => {
  it('sends a snapshot, then grouped deltas, then config and assets changes', async () => {
    const c = await start(4312);
    c.server.ingest(ev(c.clock, 'agent:s1', 'turn.start', undefined, { labels: { host: 'h' } }));
    const s = await sse(`${c.url}/events`);
    await waitFor(() => s.frames.length >= 3);
    expect(s.frames.map((f) => f.event).slice(0, 3)).toEqual(['snapshot', 'config', 'assets']);
    expect(s.frames[0]!.data.entities.map((e: any) => e.id)).toEqual(['agent:s1']);
    const seq0 = s.frames[0]!.data.seq;

    // a burst of events lands in a single delta
    for (let i = 0; i < 20; i++) c.server.ingest(ev(c.clock, 'agent:s1', 'tool.pre', { tool: 'Edit', detail: `f${i}` }));
    c.server.ingest(ev(c.clock, 'agent:s2', 'turn.start', undefined, { labels: { host: 'h' } }));
    const d = await waitFor(() => s.frames.find((f) => f.event === 'delta'));
    expect(d.data.seq).toBe(seq0 + 1);
    expect(d.data.upsert.map((e: any) => e.id).sort()).toEqual(['agent:s1', 'agent:s2']);
    expect(d.data.events).toHaveLength(21);
    expect(d.data.groups[0]).toMatchObject({ id: 'h', metrics: { agents: 2 } });
    expect(s.frames.filter((f) => f.event === 'delta')).toHaveLength(1);

    // removal arrives as a delta
    c.server.ingest(ev(c.clock, 'agent:s2', 'session.end'));
    c.clock.advance(60);
    c.server.tick();
    const rm = await waitFor(() => s.frames.find((f) => f.event === 'delta' && f.data.remove));
    expect(rm.data.remove).toEqual(['agent:s2']);

    // config + assets events on change
    const n = s.frames.length;
    const next = c.server.config;
    const r = await put(`${c.url}/api/config`, { ...next, fun: { ...next.fun, everySec: 3 } });
    expect(r.status).toBe(200);
    await waitFor(() => s.frames.slice(n).some((f) => f.event === 'config' && f.data.fun.everySec === 3));
    const up = await put(`${c.url}/api/assets/a.px.json`, { px: 1, sprites: [] });
    expect(up.status).toBe(200);
    await waitFor(() => s.frames.slice(n).some((f) => f.event === 'assets' && f.data.some((a: any) => a.name === 'a.px.json')));
    s.close();
  });
});

describe('PUT /api/config', () => {
  it('applies a valid config, writes it atomically to disk and hot-reloads inputs', async () => {
    const dir = tmp();
    const configPath = path.join(dir, 'config.json');
    const file = path.join(dir, 'in.jsonl');
    fs.writeFileSync(file, '');
    const c = await start(4312, {}, { configPath });
    const cur = await (await fetch(`${c.url}/api/config`)).json() as any;

    const next = {
      ...cur,
      inputs: [...cur.inputs, { id: 'f', type: 'file', path: file, adapter: 'pa' }],
      classify: [{ name: 'r', match: { kind: 'agent' }, set: { 'view.skin': 'blue' } }],
    };
    c.server.ingest(ev(c.clock, 'agent:cfg', 'turn.start', undefined, { labels: { host: 'h' } }));
    const r = await put(`${c.url}/api/config`, next);
    expect(r.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).inputs.map((i: any) => i.id)).toEqual(['http', 'f']);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
    // reclassified in place
    expect(c.server.snapshot().entities[0]!.view.skin).toBe('blue');
    // new input is live
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), source: '', entity: 'agent:viafile', kind: 'turn.start' }) + '\n');
    await waitFor(() => c.server.snapshot().entities.some((e) => e.id === 'agent:viafile'));

    // changing the port asks for a restart, nothing else breaks
    const r2 = await put(`${c.url}/api/config`, { ...next, server: { ...next.server, port: 4319 } });
    expect(r2.status).toBe(200);
    expect((await r2.json() as any).restartRequired).toEqual(['server.port']);
  });

  it('only restarts the inputs that changed', async () => {
    const dir = tmp();
    const f1 = path.join(dir, 'a.jsonl');
    const f2 = path.join(dir, 'b.jsonl');
    fs.writeFileSync(f1, '');
    fs.writeFileSync(f2, '');
    const mk = (extra: object[]) => [{ id: 'http', type: 'http', adapter: 'pa' }, { id: 'a', type: 'file', path: f1, adapter: 'pa', fromStart: true }, ...extra];
    const c = await start(4312, { inputs: mk([{ id: 'b', type: 'file', path: f2, adapter: 'pa', fromStart: true }]) });
    const line = (e: string) => JSON.stringify({ ts: new Date().toISOString(), source: '', entity: e, kind: 'turn.start' }) + '\n';
    fs.appendFileSync(f1, line('agent:one'));
    await waitFor(() => c.server.snapshot().entities.some((e) => e.id === 'agent:one'));

    // restart "b" by changing it; "a" has fromStart and would replay "agent:one" if restarted -> detect via history
    const cur = await (await fetch(`${c.url}/api/config`)).json() as any;
    const next = { ...cur, inputs: mk([{ id: 'b', type: 'file', path: f2, adapter: 'pa', fromStart: true, options: { v: 2 } }]) };
    expect((await put(`${c.url}/api/config`, next)).status).toBe(200);
    fs.appendFileSync(f2, line('agent:two'));
    await waitFor(() => c.server.snapshot().entities.some((e) => e.id === 'agent:two'));
    const one = c.server.snapshot().entities.find((e) => e.id === 'agent:one')!;
    expect(one.history.filter((h) => h.kind === 'turn.start')).toHaveLength(1);
  });

  it('rejects invalid configs with 400 and a list of errors, leaving everything untouched', async () => {
    const dir = tmp();
    const configPath = path.join(dir, 'config.json');
    const c = await start(4312, {}, { configPath });
    const cur = await (await fetch(`${c.url}/api/config`)).json() as any;

    const bad = { ...cur, timing: { ...cur.timing, sleepAfterSec: -5 }, world: { ...cur.world, fps: 'fast' } };
    const r = await put(`${c.url}/api/config`, bad);
    expect(r.status).toBe(400);
    const body = await r.json() as any;
    expect(body.errors.length).toBeGreaterThanOrEqual(2);
    expect(body.errors.map((e: any) => e.path)).toContain('/timing/sleepAfterSec');
    expect(fs.existsSync(configPath)).toBe(false);
    expect(c.server.config.timing.sleepAfterSec).toBe(cur.timing.sleepAfterSec);

    expect((await put(`${c.url}/api/config`, '{not json')).status).toBe(400);
    expect((await put(`${c.url}/api/config`, { version: 1 })).status).toBe(400);
  });

  it('never leaks the token and keeps it when the web sends the redacted value back', async () => {
    const c = await start(4312, { server: { host: '127.0.0.1', port: 4312, token: 'sekret' } });
    const cur = await (await fetch(`${c.url}/api/config`)).json() as any;
    expect(cur.server.token).toBe('***');
    const s = await sse(`${c.url}/events`);
    await waitFor(() => s.frames.find((f) => f.event === 'config'));
    expect(JSON.stringify(s.frames)).not.toContain('sekret');
    s.close();
    const r = await put(`${c.url}/api/config`, { ...cur, fun: { ...cur.fun, everySec: 9 } }, { authorization: 'Bearer sekret' });
    expect(r.status).toBe(200);
    expect(c.server.config.server.token).toBe('sekret');
  });
});

describe('security', () => {
  it('on loopback without token everything is open', async () => {
    const c = await start(4313);
    expect((await post(`${c.url}/v1/events`, '{}')).status).toBe(202);
  });

  it('requires the bearer token (or ?token=) on ingest and PUT when a token is set', async () => {
    const c = await start(4313, { server: { host: '127.0.0.1', port: 4313, token: 'tok' } });
    const body = JSON.stringify({ ts: new Date().toISOString(), source: '', entity: 'agent:t', kind: 'turn.start' });
    expect((await post(`${c.url}/v1/events`, body)).status).toBe(401);
    expect((await post(`${c.url}/v1/events`, body, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await post(`${c.url}/v1/events`, body, { authorization: 'Bearer tok' })).status).toBe(202);
    expect((await post(`${c.url}/v1/events?token=tok`, body)).status).toBe(202);
    const cfg = await (await fetch(`${c.url}/api/config`)).json() as any;
    expect((await put(`${c.url}/api/config`, cfg)).status).toBe(401);
    expect((await put(`${c.url}/api/assets/x.px.json`, { px: 1, sprites: [] })).status).toBe(401);
    expect((await put(`${c.url}/api/config`, cfg, { authorization: 'Bearer tok' })).status).toBe(200);
    expect((await fetch(`${c.url}/healthz`)).status).toBe(200);
  });

  it('a non-loopback host makes the token mandatory, and without a configured token nobody gets in', async () => {
    const withTok = await start(4313, { server: { host: '0.0.0.0', port: 4313, token: 'tok' } });
    expect((await post(`${withTok.url}/v1/events`, '{}')).status).toBe(401);
    expect((await post(`${withTok.url}/v1/events`, '{}', { authorization: 'Bearer tok' })).status).toBe(202);
    await withTok.server.close();
    const noTok = await start(4314, { server: { host: '0.0.0.0', port: 4314 } });
    expect((await post(`${noTok.url}/v1/events`, '{}')).status).toBe(401);
    expect((await post(`${noTok.url}/v1/events`, '{}', { authorization: 'Bearer anything' })).status).toBe(401);
    // and the web cannot configure itself into that state
    const cur = noTok.server.config;
    expect((await noTok.server.applyConfig(cur)).ok).toBe(false);
  });

  it('CORS only for the Vite dev origin', async () => {
    const c = await start(4313);
    const ok = await fetch(`${c.url}/api/state`, { headers: { origin: 'http://localhost:5173' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const bad = await fetch(`${c.url}/api/state`, { headers: { origin: 'http://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await fetch(`${c.url}/api/config`, { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } });
    expect(pre.status).toBe(204);
  });
});

describe('assets', () => {
  it('uploads .px.json and .png, lists them, serves them, rejects the rest, watches config.assets folders', async () => {
    const extra = tmp();
    fs.writeFileSync(path.join(extra, 'disk.px.json'), JSON.stringify({ px: 1, sprites: [] }));
    const c = await start(4313, { assets: [extra] });
    const names = async () => (await (await fetch(`${c.url}/api/assets`)).json() as any).map((a: any) => a.name);
    expect(await names()).toEqual(['disk.px.json']);

    expect((await put(`${c.url}/api/assets/hero.px.json`, { px: 1, sprites: [{ name: 'a' }] })).status).toBe(200);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    expect((await put(`${c.url}/api/assets/pic.png`, png)).status).toBe(200);
    expect(fs.existsSync(path.join(c.dir, 'assets', 'hero.px.json'))).toBe(true);
    expect(await names()).toEqual(['disk.px.json', 'hero.px.json', 'pic.png']);
    expect(Buffer.from(await (await fetch(`${c.url}/api/assets/pic.png`)).arrayBuffer()).equals(png)).toBe(true);

    expect((await put(`${c.url}/api/assets/evil.exe`, 'x')).status).toBe(400);
    expect((await put(`${c.url}/api/assets/..%2Fx.png`, png)).status).toBe(400);
    expect((await put(`${c.url}/api/assets/bad.px.json`, '{"nope":1}')).status).toBe(400);
    expect((await put(`${c.url}/api/assets/bad.png`, 'not a png')).status).toBe(400);

    // new file in a watched folder shows up in an SSE assets event
    const s = await sse(`${c.url}/events`);
    await waitFor(() => s.frames.length >= 3);
    fs.writeFileSync(path.join(extra, 'later.px.json'), JSON.stringify({ px: 1, sprites: [] }));
    await waitFor(() => s.frames.some((f) => f.event === 'assets' && f.data.some((a: any) => a.name === 'later.px.json')));
    s.close();
  });
});

describe('static web', () => {
  it('serves webRoot with SPA fallback and no path traversal', async () => {
    const web = tmp();
    fs.writeFileSync(path.join(web, 'index.html'), '<h1>pa</h1>');
    fs.mkdirSync(path.join(web, 'assets'));
    fs.writeFileSync(path.join(web, 'assets', 'app.js'), 'console.log(1)');
    fs.writeFileSync(path.join(path.dirname(web), 'secret.txt'), 'top secret');
    const c = await start(4313, {}, { webRoot: web });
    expect(await (await fetch(`${c.url}/`)).text()).toBe('<h1>pa</h1>');
    expect(await (await fetch(`${c.url}/some/spa/route`)).text()).toBe('<h1>pa</h1>');
    const js = await fetch(`${c.url}/assets/app.js`);
    expect(js.headers.get('content-type')).toContain('javascript');
    expect((await fetch(`${c.url}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${c.url}/api/nothing`)).status).toBe(404);
    const raw = await new Promise<number>((resolve) => {
      import('node:http').then(({ default: http }) => {
        http.get({ host: '127.0.0.1', port: c.server.port, path: '/../secret.txt' }, (res) => resolve(res.statusCode ?? 0));
      });
    });
    expect(raw).not.toBe(200);
  });
});
