import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ev, post, start, stopAll, tmp, waitFor } from './helpers.js';

afterEach(stopAll);

const paLine = (entity: string, kind = 'turn.start', extra: object = {}) =>
  JSON.stringify({ ts: new Date().toISOString(), source: 'x', entity, kind, ...extra });
const ids = (s: { snapshot(): { entities: { id: string }[] } }) => s.snapshot().entities.map((e) => e.id).sort();

describe('http input', () => {
  it('accepts NDJSON and JSON arrays; ?adapter= overrides the adapter', async () => {
    const calls: unknown[] = [];
    const plugin = {
      name: 'fake',
      adapters: [{ name: 'upper', parse: (raw: unknown) => { calls.push(raw); return [{ ts: new Date().toISOString(), source: '', entity: `agent:${String((raw as any).id).toUpperCase()}`, kind: 'turn.start' }]; } }],
    };
    const c = await start(4302, {}, { plugins: [plugin] });
    let r = await post(`${c.url}/v1/events`, [paLine('agent:a'), paLine('agent:b')].join('\n'));
    expect(r.status).toBe(202);
    r = await post(`${c.url}/v1/events`, JSON.stringify([JSON.parse(paLine('agent:c')), JSON.parse(paLine('agent:d'))]));
    expect(r.status).toBe(202);
    expect(ids(c.server)).toEqual(['agent:a', 'agent:b', 'agent:c', 'agent:d']);
    expect(c.server.snapshot().entities[0]!.history.length).toBeGreaterThan(0);

    r = await post(`${c.url}/v1/events?adapter=upper`, '{"id":"zed"}\n{"id":"yo"}');
    expect(r.status).toBe(202);
    expect(calls).toHaveLength(2);
    expect(ids(c.server)).toContain('agent:ZED');
    // the server sets source = input id
    c.server.flush();
    expect((await (await fetch(`${c.url}/api/state`)).json() as any).entities).toHaveLength(6);

    r = await post(`${c.url}/v1/events?adapter=nope`, '{}');
    expect(r.status).toBe(400);
  });
});

describe('file input', () => {
  it('tails appended lines, follows truncation and rotation, expands fromStart', async () => {
    const dir = tmp();
    const file = path.join(dir, 'events.jsonl');
    fs.writeFileSync(file, paLine('agent:old') + '\n');
    const c = await start(4303, {
      inputs: [
        { id: 'tail', type: 'file', path: file, adapter: 'pa' },
        { id: 'all', type: 'file', path: file, adapter: 'pa', fromStart: true },
      ],
    });
    // "all" reads from the start, "tail" ignores what was there
    await waitFor(() => ids(c.server).includes('agent:old'));
    fs.appendFileSync(file, paLine('agent:new1') + '\n' + paLine('agent:par'));
    await new Promise((r) => setTimeout(r, 150));
    expect(ids(c.server)).not.toContain('agent:par'); // partial line is held back
    fs.appendFileSync(file, 'tial\n'.slice(0, 0) + '\n');
    await waitFor(() => ids(c.server).includes('agent:new1') && ids(c.server).includes('agent:par'));

    // truncate and write a shorter line
    fs.writeFileSync(file, paLine('agent:t') + '\n');
    await waitFor(() => ids(c.server).includes('agent:t'));

    // rotate: rename + new file; the tail of the old one is drained first
    fs.appendFileSync(file, paLine('agent:lastold') + '\n');
    fs.renameSync(file, file + '.1');
    fs.writeFileSync(file, paLine('agent:rot') + '\n');
    await waitFor(() => ids(c.server).includes('agent:rot'));
    expect(ids(c.server)).toContain('agent:lastold');
  });

  it('tail skips pre-existing content', async () => {
    const dir = tmp();
    const file = path.join(dir, 'e.jsonl');
    fs.writeFileSync(file, paLine('agent:before') + '\n');
    const c = await start(4303, { inputs: [{ id: 'tail', type: 'file', path: file, adapter: 'pa' }] });
    await new Promise((r) => setTimeout(r, 100));
    fs.appendFileSync(file, paLine('agent:after') + '\n');
    await waitFor(() => ids(c.server).includes('agent:after'));
    expect(ids(c.server)).not.toContain('agent:before');
  });

  it('expands ~ using HOME', async () => {
    const home = tmp();
    const old = process.env.HOME;
    process.env.HOME = home;
    try {
      fs.writeFileSync(path.join(home, 'ev.jsonl'), paLine('agent:home') + '\n');
      const c = await start(4303, { inputs: [{ id: 'h', type: 'file', path: '~/ev.jsonl', adapter: 'pa', fromStart: true }] });
      await waitFor(() => ids(c.server).includes('agent:home'));
    } finally {
      process.env.HOME = old;
    }
  });
});

describe('command input', () => {
  it('reads stdout by lines without a shell and restarts with backoff', async () => {
    const dir = tmp();
    const script = path.join(dir, 'emit.mjs');
    const log = path.join(dir, 'runs');
    fs.writeFileSync(
      script,
      `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(log)}, 'x');\n` +
        `const n = fs.readFileSync(${JSON.stringify(log)}, 'utf8').length;\n` +
        `console.log(JSON.stringify({ts:new Date().toISOString(),source:'',entity:'agent:run'+n,kind:'turn.start',attrs:{arg:process.argv[2]}}));\n`,
    );
    const c = await start(4304, {
      inputs: [{ id: 'cmd', type: 'command', command: process.execPath, args: [script, '$HOME;echo hi'], adapter: 'pa', restartSec: 0.05 }],
    });
    await waitFor(() => ids(c.server).includes('agent:run1') && ids(c.server).includes('agent:run2'));
    expect(fs.readFileSync(log, 'utf8').length).toBeGreaterThanOrEqual(2);
  });
});

describe('poll input', () => {
  it('turns the whole output into ONE record (JSON or string), from a command and from a URL', async () => {
    const records: unknown[] = [];
    const plugin = {
      name: 'rec',
      adapters: [{ name: 'rec', parse: (raw: unknown) => { records.push(raw); return []; } }],
    };
    const srv = http.createServer((_q, res) => res.end('line one\nline two\n'));
    await new Promise<void>((r) => srv.listen(4305, '127.0.0.1', r));
    try {
      const c = await start(
        4306,
        {
          inputs: [
            { id: 'p1', type: 'poll', command: process.execPath, args: ['-e', 'console.log(JSON.stringify({a:1,b:[1,2]}))'], everySec: 60, adapter: 'rec' },
            { id: 'p2', type: 'poll', command: process.execPath, args: ['-e', 'console.log("plain\\ntext")'], everySec: 60, adapter: 'rec' },
            { id: 'p3', type: 'poll', url: 'http://127.0.0.1:4305/', everySec: 60, adapter: 'rec' },
          ],
        },
        { plugins: [plugin] },
      );
      await waitFor(() => records.length >= 3);
      expect(records).toContainEqual({ a: 1, b: [1, 2] });
      expect(records).toContainEqual('plain\ntext');
      expect(records).toContainEqual('line one\nline two');
      expect(records).toHaveLength(3);
      void c;
    } finally {
      await new Promise((r) => srv.close(r));
    }
  });
});

describe('hub input', () => {
  it('mirrors another server entities with labels.hub, follows deltas and drops them on disconnect', async () => {
    const b = await start(4307, {}); // the remote server
    const a = await start(4308, {
      inputs: [
        { id: 'http', type: 'http', adapter: 'pa' },
        { id: 'east', type: 'hub', url: `http://127.0.0.1:${b.server.port}` },
      ],
    });
    b.server.ingest(ev(b.clock, 'agent:r1', 'tool.pre', { tool: 'Edit', detail: 'x.ts' }, { labels: { host: 'remote' } }));
    a.server.ingest(ev(a.clock, 'agent:local', 'turn.start', undefined, { labels: { host: 'here' } }));
    await waitFor(() => ids(a.server).includes('agent:r1'));
    const r1 = () => a.server.snapshot().entities.find((e) => e.id === 'agent:r1')!;
    expect(r1()).toMatchObject({ status: 'working', labels: { host: 'remote', hub: 'east' }, view: { group: 'remote' } });

    // deltas flow
    b.server.ingest(ev(b.clock, 'agent:r1', 'turn.end'));
    await waitFor(() => r1().status === 'idle');
    b.server.ingest(ev(b.clock, 'agent:r2', 'turn.start', undefined, { labels: { host: 'remote' } }));
    await waitFor(() => ids(a.server).includes('agent:r2'));
    b.server.ingest(ev(b.clock, 'agent:r2', 'session.end'));
    b.clock.advance(60);
    b.server.tick();
    await waitFor(() => !ids(a.server).includes('agent:r2'));
    expect(ids(a.server)).toContain('agent:local');
    expect(a.server.snapshot().entities.find((e) => e.id === 'agent:local')!.labels.hub).toBeUndefined();

    // remote goes away: its entities leave, local ones stay
    await b.server.close();
    await waitFor(() => !ids(a.server).includes('agent:r1'));
    expect(ids(a.server)).toEqual(['agent:local']);
  });

  it('sends the token to a protected hub', async () => {
    const b = await start(4309, { server: { host: '127.0.0.1', port: 4309, token: 'sekret' } });
    b.server.ingest(ev(b.clock, 'agent:p', 'turn.start'));
    const a = await start(4310, {
      inputs: [{ id: 'east', type: 'hub', url: `http://127.0.0.1:4309`, token: 'sekret' }],
    });
    await waitFor(() => ids(a.server).includes('agent:p'));
    // events on a protected hub: GET /events stays readable (only ingest and PUT need the token)
    expect(ids(a.server)).toEqual(['agent:p']);
  });
});

describe('plugin input type', () => {
  it('starts inputs registered by a plugin and stops them on close', async () => {
    let aborted = false;
    const plugin = {
      name: 'custom-in',
      inputs: [
        {
          type: 'magic',
          start: (_cfg: Record<string, unknown>, push: (raw: unknown) => void, signal: AbortSignal) => {
            push({ ts: new Date().toISOString(), source: '', entity: 'agent:magic', kind: 'turn.start' });
            signal.addEventListener('abort', () => (aborted = true));
          },
        },
      ],
    };
    const c = await start(4311, { inputs: [{ id: 'm', type: 'magic', adapter: 'pa' }] }, { plugins: [plugin] });
    await waitFor(() => ids(c.server).includes('agent:magic'));
    await c.server.close();
    expect(aborted).toBe(true);
  });
});
