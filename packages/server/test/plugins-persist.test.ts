import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ev, post, start, stopAll, tmp, waitFor } from './helpers.js';

afterEach(stopAll);

function writePlugin(dir: string): { file: string; client: string } {
  const client = path.join(dir, 'client.js');
  fs.writeFileSync(client, 'export default { hello: 1 };');
  const file = path.join(dir, 'plugin.mjs');
  fs.writeFileSync(
    file,
    `
export default {
  name: 'demo',
  clientEntry: ${JSON.stringify(client)},
  defaults: {
    classify: [{ name: 'demo-rule', match: { kind: 'vm' }, set: { 'view.skin': 'robot' } }],
    skins: { robot: { palette: { B: '#888888' } } },
    behaviors: { robot: { '*': 'idle' } },
  },
  adapters: [{
    name: 'vmjson',
    parse(raw, ctx) {
      return [{ ts: ctx.now().toISOString(), source: '', entity: 'vm:' + raw.vm, kind: 'vm.state', attrs: { state: raw.state } }];
    },
  }],
  reducers: [{
    name: 'vm-state',
    kinds: ['vm.'],
    reduce(entity, ev) {
      entity.status = ev.attrs.state === 'up' ? 'working' : String(ev.attrs.state);
      entity.metrics.updates = (entity.metrics.updates ?? 0) + 1;
      return entity;
    },
  }, {
    name: 'never-called',
    kinds: ['nothing.'],
    reduce() { throw new Error('should be filtered'); },
  }],
  tick(ctx) {
    return [{ ts: ctx.now().toISOString(), source: '', entity: 'host:ticker', kind: 'metric', attrs: { ticks: (ctx.get('host:ticker')?.metrics.ticks ?? 0) + 1 } }];
  },
};
`,
  );
  return { file, client };
}

describe('plugins', () => {
  it('loads a plugin by path: adapter + reducer (kind filter) + tick + defaults + clientEntry', async () => {
    const dir = tmp();
    const { file, client } = writePlugin(dir);
    const c = await start(4315, { plugins: [file], inputs: [{ id: 'http', type: 'http', adapter: 'vmjson' }] });

    const r = await post(`${c.url}/v1/events`, '{"vm":"a1","state":"up"}\n{"vm":"b2","state":"frozen"}');
    expect(r.status).toBe(202);
    const snap = c.server.snapshot();
    const vm = (id: string) => snap.entities.find((e) => e.id === id)!;
    expect(vm('vm:a1')).toMatchObject({ kind: 'vm', status: 'working', metrics: { updates: 1 }, view: { skin: 'robot' } });
    expect(vm('vm:b2').status).toBe('frozen');
    expect(vm('vm:a1').history.at(-1)!.kind).toBe('vm.state');

    // defaults sit UNDER the user's config
    expect(c.server.config.skins.robot).toEqual({ palette: { B: '#888888' } });
    expect(c.server.config.skins.default).toBeDefined();

    // tick
    c.server.tick();
    c.server.tick();
    expect(c.server.snapshot().entities.find((e) => e.id === 'host:ticker')!.metrics.ticks).toBe(2);

    // served pieces
    expect(await (await fetch(`${c.url}/api/plugins`)).json() as any).toEqual([
      { name: 'demo', adapters: ['vmjson'], reducers: ['vm-state', 'never-called'], inputs: [], client: '/plugins/demo/client.js' },
    ]);
    const cl = await fetch(`${c.url}/plugins/demo/client.js`);
    expect(cl.headers.get('content-type')).toContain('javascript');
    expect(await cl.text()).toBe(fs.readFileSync(client, 'utf8'));
    expect((await fetch(`${c.url}/plugins/nope/client.js`)).status).toBe(404);
  });

  it('the user config wins over plugin defaults', async () => {
    const dir = tmp();
    const { file } = writePlugin(dir);
    const c = await start(4315, {
      plugins: [file],
      skins: { robot: { palette: { B: '#000000' } } },
      classify: [{ name: 'mine', match: { kind: 'vm' }, set: { 'view.skin': 'mine' } }],
    });
    expect(c.server.config.skins.robot!.palette).toEqual({ B: '#000000' });
    c.server.ingest(ev(c.clock, 'vm:x', 'state', { status: 'up' }));
    expect(c.server.snapshot().entities[0]!.view.skin).toBe('mine'); // later rule wins
  });

  it('survives a plugin that fails to load or a reducer that throws', async () => {
    const dir = tmp();
    const bad = path.join(dir, 'bad.mjs');
    fs.writeFileSync(bad, 'export default { name: "bad", reducers: [{ name: "boom", reduce() { throw new Error("x"); } }] };');
    const c = await start(4315, { plugins: [bad, '/does/not/exist.mjs', 'no-such-package-xyz'] });
    c.server.ingest(ev(c.clock, 'agent:a', 'turn.start'));
    expect(c.server.snapshot().entities[0]!.status).toBe('thinking');
  });

  it('PUT /api/config reloads plugins in caliente', async () => {
    const dir = tmp();
    const { file } = writePlugin(dir);
    const c = await start(4315);
    expect(await (await fetch(`${c.url}/api/plugins`)).json() as any).toEqual([]);
    const cur = await (await fetch(`${c.url}/api/config`)).json() as any;
    const r = await fetch(`${c.url}/api/config`, {
      method: 'PUT',
      body: JSON.stringify({ ...cur, plugins: [file], inputs: [{ id: 'http', type: 'http', adapter: 'vmjson' }] }),
    });
    expect(r.status).toBe(200);
    expect((await (await fetch(`${c.url}/api/plugins`)).json() as any)[0].name).toBe('demo');
    expect((await post(`${c.url}/v1/events`, '{"vm":"q","state":"up"}')).status).toBe(202);
    expect(c.server.snapshot().entities.find((e) => e.id === 'vm:q')!.status).toBe('working');
  });
});

describe('persistence', () => {
  it('writes normalized events to log/YYYY-MM-DD.jsonl', async () => {
    const c = await start(4316);
    c.server.ingest(ev(c.clock, 'agent:l', 'tool.pre', { tool: 'Edit', detail: 'a.ts' }));
    c.server.ingest(ev(c.clock, 'agent:l', 'turn.end'));
    c.server.flush();
    const file = path.join(c.dir, 'log', '2026-01-01.jsonl');
    await waitFor(() => fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim().split('\n').length === 2);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0]).toMatchObject({ entity: 'agent:l', kind: 'tool.pre', source: 'test', attrs: { tool: 'Edit' } });
    c.clock.advance(86400);
    c.server.ingest(ev(c.clock, 'agent:l', 'turn.start'));
    c.server.flush();
    await waitFor(() => fs.existsSync(path.join(c.dir, 'log', '2026-01-02.jsonl')));
  });

  it('saves state.json periodically and on close, and restores it on start', async () => {
    const dir = tmp();
    const a = await start(4316, {}, { dataDir: dir, snapshotMs: 40 });
    a.server.ingest(ev(a.clock, 'agent:p', 'tool.pre', { tool: 'Bash', detail: 'ls' }, { labels: { host: 'h' } }));
    a.server.ingest(ev(a.clock, 'agent:p', 'metric', { cost_usd: 2 }));
    await waitFor(() => fs.existsSync(path.join(dir, 'state.json')));
    const seq = a.server.snapshot().seq;
    a.server.ingest(ev(a.clock, 'agent:q', 'turn.start'));
    await a.server.close(); // saved on exit
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    expect(saved.entities.map((e: any) => e.id).sort()).toEqual(['agent:p', 'agent:q']);
    expect(fs.readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);

    const b = await start(4316, {}, { dataDir: dir });
    const snap = b.server.snapshot();
    expect(snap.entities.map((e) => e.id).sort()).toEqual(['agent:p', 'agent:q']);
    expect(snap.entities.find((e) => e.id === 'agent:p')).toMatchObject({
      status: 'working',
      metrics: { cost_usd: 2 },
      activity: { tool: 'Bash', detail: 'ls' },
      view: { group: 'h' },
    });
    expect(snap.groups.find((g) => g.id === 'h')!.metrics.cost_usd).toBe(2);
    expect(snap.seq).toBeGreaterThanOrEqual(seq);
    // restored entities keep living: they age out with the clock
    b.clock.advance(7200);
    b.server.tick();
    expect(b.server.snapshot().entities).toHaveLength(0);
  });

  it('ignores a corrupt state.json', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'state.json'), '{broken');
    const c = await start(4316, {}, { dataDir: dir });
    expect(c.server.snapshot().entities).toEqual([]);
  });
});
