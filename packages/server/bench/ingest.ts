/**
 * Ingest benchmark: 200 events/s over HTTP (one POST per event, keep-alive) for 30 s.
 * Prints the average CPU of the server process and the p95 latency from event timestamp to the SSE delta
 * that carries it.
 *
 * The server runs in a child process so its CPU is measured alone (process.cpuUsage of that process,
 * all threads); the load generator and the SSE reader live in this process and are reported apart.
 * A second, shorter run drives a bare `node:http` server that only parses the JSON and answers 202 with
 * the same load: that is the floor any Node server pays for 200 requests/s on this machine.
 *
 *   npm run bench -w @pixelagents/server
 *   BENCH_SECONDS=30 BENCH_RATE=200 BENCH_BATCH=1 BENCH_PORT=4317 BENCH_PROF=<dir for --cpu-prof>
 */
import { fork } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, type PaConfig } from '@pixelagents/protocol';
import { createServer } from '../src/index.js';

const seconds = Number(process.env.BENCH_SECONDS ?? 30);
const rate = Number(process.env.BENCH_RATE ?? 200);
const batch = Math.max(1, Number(process.env.BENCH_BATCH ?? 1));
const port = Number(process.env.BENCH_PORT ?? 4317);
const entities = 20;

// ---------------------------------------------------------------- child: the server under test
if (process.argv.includes('--server') || process.argv.includes('--floor')) {
  const floor = process.argv.includes('--floor');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-bench-'));
  let close = async () => {};
  if (floor) {
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        for (const line of Buffer.concat(chunks).toString().split('\n')) if (line) JSON.parse(line);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end('{"accepted":1}');
      });
    });
    await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
    close = async () => void srv.close();
  } else {
    const config: PaConfig = {
      ...DEFAULT_CONFIG,
      server: { host: '127.0.0.1', port },
      plugins: [],
      inputs: [{ id: 'bench', type: 'http', adapter: 'pa' }],
      classify: [{ name: 'skin', match: { 'labels.account': '*' }, set: { 'view.skin': '{{labels.account}}' } }],
    };
    const srv = createServer(config, { dataDir, log: () => {} });
    await srv.listen();
    close = () => srv.close();
  }
  let cpu0 = process.cpuUsage();
  process.on('message', async (m: string) => {
    if (m === 'mark') cpu0 = process.cpuUsage();
    if (m === 'report') {
      const c = process.cpuUsage(cpu0);
      process.send!({ cpuSec: (c.user + c.system) / 1e6, userSec: c.user / 1e6, rssMB: Math.round(process.memoryUsage().rss / 1e6) });
    }
    if (m === 'exit') {
      await close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      process.exit(0);
    }
  });
  process.send!('ready');
  await new Promise(() => {});
}

// ---------------------------------------------------------------- parent: load generator + SSE reader
interface Report {
  seconds: number;
  sent: number;
  failed: number;
  serverCpuAvgPct: number;
  serverUserPct: number;
  loadGeneratorCpuPct: number;
  deltas: number;
  eventsSeenInDeltas: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number | undefined };
  serverRssMB: number;
}

async function run(mode: '--server' | '--floor', secs: number): Promise<Report> {
  const prof = process.env.BENCH_PROF ? ['--cpu-prof', `--cpu-prof-dir=${process.env.BENCH_PROF}`] : [];
  const child = fork(fileURLToPath(import.meta.url), [mode], { execArgv: [...process.execArgv, ...prof] });
  await new Promise<void>((resolve) => child.once('message', () => resolve()));
  const ask = (m: string) =>
    new Promise<{ cpuSec: number; userSec: number; rssMB: number }>((resolve) => {
      child.once('message', resolve as never);
      child.send(m);
    });

  // SSE reader: latency = arrival of the delta − timestamp of each event inside it.
  const latencies: number[] = [];
  let deltas = 0;
  let sse: http.ClientRequest | undefined;
  if (mode === '--server') {
    let buf = '';
    sse = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (!block.startsWith('event: delta')) continue;
          const received = Date.now();
          const d = JSON.parse(block.slice(block.indexOf('data: ') + 6)) as { events?: { ts: string }[] };
          deltas++;
          for (const e of d.events ?? []) latencies.push(received - Date.parse(e.ts));
        }
      });
    });
  }

  const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
  let sent = 0;
  let failed = 0;
  const kinds = ['tool.pre', 'tool.post', 'turn.start', 'turn.end', 'metric'];
  const mkEvent = (n: number) => ({
    ts: new Date().toISOString(),
    source: 'bench',
    entity: `agent:b${n % entities}`,
    kind: kinds[n % kinds.length],
    attrs: n % 5 === 0 ? { tool: 'Edit', detail: `src/file${n % 50}.ts` } : n % 5 === 4 ? { cost_usd: n / 1000 } : { tool: 'Read' },
    labels: { host: `host${n % 4}`, account: `acc${n % 3}`, repo: 'bench' },
  });
  function post(): void {
    const evs = Array.from({ length: batch }, () => mkEvent(sent++));
    const req = http.request({ host: '127.0.0.1', port, path: '/v1/events', method: 'POST', agent }, (res) => {
      if (res.statusCode !== 202) failed++;
      res.resume();
    });
    req.on('error', () => failed++);
    req.end(batch === 1 ? JSON.stringify(evs[0]) : evs.map((e) => JSON.stringify(e)).join('\n'));
  }

  await new Promise((r) => setTimeout(r, 300)); // let the SSE connection settle
  child.send('mark');
  const cpuClient0 = process.cpuUsage();
  const t0 = performance.now();
  const total = secs * rate;
  await new Promise<void>((resolve) => {
    const tick = (): void => {
      const due = Math.min(total, Math.floor(((performance.now() - t0) / 1000) * rate));
      while (sent < due) post();
      if (sent >= total) return resolve();
      setTimeout(tick, 5);
    };
    tick();
  });
  const wall = (performance.now() - t0) / 1000;
  const clientCpu = process.cpuUsage(cpuClient0);
  const rep = await ask('report');
  await new Promise((r) => setTimeout(r, 400)); // last deltas

  latencies.sort((a, b) => a - b);
  const pct = (p: number): number => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? NaN;
  const r1 = (x: number) => Math.round(x * 100) / 100;
  sse?.destroy();
  agent.destroy();
  child.send('exit');
  return {
    seconds: r1(wall),
    sent,
    failed,
    serverCpuAvgPct: r1((rep.cpuSec / wall) * 100),
    serverUserPct: r1((rep.userSec / wall) * 100),
    loadGeneratorCpuPct: r1(((clientCpu.user + clientCpu.system) / 1e6 / wall) * 100),
    deltas,
    eventsSeenInDeltas: latencies.length,
    latencyMs: { p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: latencies.at(-1) },
    serverRssMB: rep.rssMB,
  };
}

const main = await run('--server', seconds);
await new Promise((r) => setTimeout(r, 800)); // let the first child release the port
const floor = await run('--floor', Math.min(seconds, 10));
console.log(JSON.stringify({ config: { rate, batch, seconds }, pixelagents: main, bareNodeHttpFloor: { serverCpuAvgPct: floor.serverCpuAvgPct, failed: floor.failed } }, null, 2));
const ok = main.serverCpuAvgPct < 5 && main.failed === 0 && main.eventsSeenInDeltas >= main.sent * 0.99;
console.log(
  ok
    ? 'PASS: server CPU < 5 % and every event reached a delta'
    : `FAIL: server CPU ${main.serverCpuAvgPct} % (a bare node:http server doing nothing but parse+202 costs ${floor.serverCpuAvgPct} % under the same load)`,
);
process.exit(ok ? 0 : 1);
