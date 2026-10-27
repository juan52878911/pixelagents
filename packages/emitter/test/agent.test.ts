import { appendFileSync, readFileSync, renameSync, truncateSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startAgent, type AgentHandle } from '../src/index.js';
import { tmp } from './helpers.js';

interface Hit {
  adapter: string;
  auth: string | undefined;
  type: string | undefined;
  lines: string[];
}

const servers: Server[] = [];
const agents: AgentHandle[] = [];
afterEach(async () => {
  for (const a of agents.splice(0)) await a.stop();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function fake(opts: { token?: string } = {}) {
  const hits: Hit[] = [];
  const st = { up: true, status: 200 };
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (!st.up) return void req.socket.destroy();
      if (opts.token && req.headers.authorization !== `Bearer ${opts.token}`) {
        res.statusCode = 401;
        return void res.end();
      }
      const url = new URL(req.url ?? '/', 'http://x');
      if (st.status === 200)
        hits.push({
          adapter: url.searchParams.get('adapter') ?? '',
          auth: req.headers.authorization,
          type: req.headers['content-type'],
          lines: Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean),
        });
      res.statusCode = url.pathname === '/v1/events' ? st.status : 404;
      res.end();
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { hub: `http://127.0.0.1:${port}`, hits, st, claude: () => hits.filter((h) => h.adapter === 'claude-code').flatMap((h) => h.lines) };
}

const line = (n: number) => JSON.stringify({ v: 1, n });
const mk = (dir: string, from: number, to: number) => {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(line(i));
  appendFileSync(join(dir, 'events.jsonl'), out.join('\n') + '\n');
};
const start = (o: Parameters<typeof startAgent>[0]) => {
  const a = startAgent({ pollMs: 10, backoffMs: 20, maxBackoffMs: 60, metricsMs: 0, ...o });
  agents.push(a);
  return a;
};
const nums = (ls: string[]) => ls.map((l) => (JSON.parse(l) as { n: number }).n);

describe('pixelagents agent', () => {
  it('sends batches with the token, as NDJSON, in order', async () => {
    const f = await fake({ token: 'T0K' });
    const dir = tmp();
    mk(dir, 1, 25);
    const a = start({ hub: f.hub + '/', token: 'T0K', dir, maxBatchLines: 10 });
    await a.drain();
    expect(nums(f.claude())).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(f.hits.map((h) => h.lines.length)).toEqual([10, 10, 5]);
    expect(f.hits[0]).toMatchObject({ auth: 'Bearer T0K', type: 'application/x-ndjson' });
    mk(dir, 26, 27); // live tail
    await a.drain();
    expect(nums(f.claude()).slice(-2)).toEqual([26, 27]);
  });

  it('a wrong token delivers nothing and never advances', async () => {
    const f = await fake({ token: 'right' });
    const dir = tmp();
    mk(dir, 1, 3);
    const a = start({ hub: f.hub, token: 'wrong', dir });
    await new Promise((r) => setTimeout(r, 200));
    expect(f.hits).toHaveLength(0);
    expect(a.stats.failures).toBeGreaterThan(0);
  });

  it('network cut and resume: no loss, no duplicates', async () => {
    const f = await fake();
    const dir = tmp();
    mk(dir, 1, 5);
    const a = start({ hub: f.hub, token: 't', dir });
    await a.drain();
    f.st.up = false; // cut
    mk(dir, 6, 40);
    await new Promise((r) => setTimeout(r, 150));
    expect(a.stats.failures).toBeGreaterThan(0);
    expect(nums(f.claude())).toEqual([1, 2, 3, 4, 5]);
    f.st.up = true; // resume
    await a.drain();
    expect(nums(f.claude())).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it('server errors (5xx) are retried; rejected batches (400) are dropped', async () => {
    const f = await fake();
    const dir = tmp();
    f.st.status = 503;
    mk(dir, 1, 3);
    const a = start({ hub: f.hub, token: 't', dir });
    await new Promise((r) => setTimeout(r, 100));
    f.st.status = 200;
    await a.drain();
    expect(nums(f.claude())).toEqual([1, 2, 3]);
    f.st.status = 400;
    mk(dir, 4, 4);
    await a.drain();
    f.st.status = 200;
    mk(dir, 5, 5);
    await a.drain();
    expect(nums(f.claude())).toEqual([1, 2, 3, 5]);
    expect(a.stats.droppedLines).toBe(1);
  });

  it('restart resumes from the persisted offset', async () => {
    const f = await fake();
    const dir = tmp();
    mk(dir, 1, 10);
    const a = start({ hub: f.hub, token: 't', dir });
    await a.drain();
    await a.stop();
    expect(JSON.parse(readFileSync(join(dir, 'agent-state.json'), 'utf8')).files[join(dir, 'events.jsonl')].offset).toBeGreaterThan(0);
    mk(dir, 11, 15);
    const b = start({ hub: f.hub, token: 't', dir });
    await b.drain();
    expect(nums(f.claude())).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('survives truncation and rotation; waits for incomplete lines', async () => {
    const f = await fake();
    const dir = tmp();
    const file = join(dir, 'events.jsonl');
    mk(dir, 1, 3);
    const a = start({ hub: f.hub, token: 't', dir });
    await a.drain();
    appendFileSync(file, '{"v":1,"n":4'); // partial line
    await new Promise((r) => setTimeout(r, 80));
    expect(nums(f.claude())).toEqual([1, 2, 3]);
    appendFileSync(file, '}\n');
    await a.drain();
    expect(nums(f.claude())).toEqual([1, 2, 3, 4]);

    renameSync(file, join(dir, 'events.jsonl.1')); // rotation
    mk(dir, 5, 5);
    await a.drain();
    truncateSync(file, 0); // truncation
    mk(dir, 6, 6);
    await a.drain();
    expect(nums(f.claude())).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('follows extra files and reports host metrics on ?adapter=pa', async () => {
    const f = await fake();
    const dir = tmp();
    const extra = join(tmp(), 'other.jsonl');
    writeFileSync(extra, line(100) + '\n');
    const a = start({ hub: f.hub, token: 't', dir, files: [extra], metricsMs: 40, host: 'box' });
    await a.drain();
    await new Promise((r) => setTimeout(r, 120));
    expect(nums(f.claude())).toEqual([100]);
    const pa = f.hits.filter((h) => h.adapter === 'pa').map((h) => JSON.parse(h.lines[0]!));
    expect(pa.length).toBeGreaterThanOrEqual(2);
    expect(pa[0]).toMatchObject({ entity: 'host:box', kind: 'metric' });
    expect(Object.keys(pa[0].attrs).sort()).toEqual(['cpus', 'load', 'mem_used_pct']);
    expect(pa[0].attrs.cpus).toBeGreaterThan(0);
  });
});
