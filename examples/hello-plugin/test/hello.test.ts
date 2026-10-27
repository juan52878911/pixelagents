import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../../../packages/server/src/index.js';
import { CONFIG_SCHEMA, DEFAULT_CONFIG, applyRules, mergeConfig, type Entity, type PaConfig } from '@pixelagents/protocol';
import hello, { helloAdapter, helloReducer } from '../src/index.js';
import client, { sepia } from '../src/client/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { input: 'hello', options: {}, now: () => new Date('2026-01-01T00:00:00Z') };
const blank = (id: string): Entity => ({ id, kind: id.split(':')[0]!, labels: {}, status: 'starting', metrics: {}, firstSeen: '', lastSeen: '', history: [], view: {} });
const valid = (cfg: unknown): boolean => { const a = new Ajv2020({ strict: false }); const ok = a.validate(CONFIG_SCHEMA, cfg); if (!ok) console.error(a.errors); return ok as boolean; };

describe('hello plugin', () => {
  it('the sample command prints JSON the adapter understands (poll source)', () => {
    const out = execFileSync(process.execPath, [resolve(root, 'bin/sample.mjs')], { encoding: 'utf8' });
    const events = helloAdapter.parse(JSON.parse(out), ctx);
    expect(events.map((e) => e.entity).sort()).toEqual(['job:backup', 'job:build', 'job:deploy']);
    expect(events[0]).toMatchObject({ kind: 'hello.job', source: 'hello' });
  });

  it('adapter reads only its fields and skips junk', () => {
    const ev = helloAdapter.parse([{ name: 'x', state: 'running', progress: 5, host: 'h', SECRET: 'no' }, 3, { state: 'running' }], ctx);
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev)).not.toContain('SECRET');
    expect(ev[0]).toMatchObject({ entity: 'job:x', labels: { host: 'h' }, attrs: { state: 'running', progress: 5 } });
  });

  it('reducer maps state to status and progress to a metric', () => {
    const [ev] = helloAdapter.parse({ name: 'x', state: 'running', progress: 40 }, ctx);
    const e = helloReducer.reduce(blank('job:x'), ev!, { config: DEFAULT_CONFIG, now: ctx.now, get: () => undefined })!;
    expect(e.status).toBe('working');
    expect(e.metrics.progress).toBe(40);
    expect(e.activity?.detail).toBe('x running');
  });

  it('the rule makes jobs minions, and the defaults merged into the config still validate', () => {
    const e = applyRules(blank('job:x'), hello.defaults!.classify!);
    expect(e.view.behavior).toBe('minion');
    expect(valid(mergeConfig(DEFAULT_CONFIG, hello.defaults) as PaConfig)).toBe(true);
  });

  it('config.example.json is a valid layer on top of the defaults', () => {
    const user = JSON.parse(readFileSync(resolve(root, 'config.example.json'), 'utf8'));
    expect(valid(mergeConfig(DEFAULT_CONFIG, user))).toBe(true);
  });

  it('the server plugin points at its client bundle', () => {
    expect(hello.clientEntry).toMatch(/hello-plugin\/dist\/client\.js$/);
  });
});

describe('end to end with the real server', () => {
  it('sample output -> adapter -> reducer -> classification, seen in /api/state', async () => {
    const cfg = mergeConfig(DEFAULT_CONFIG, { server: { host: '127.0.0.1', port: 5382 }, plugins: [], inputs: [{ id: 'http', type: 'http', adapter: 'hello' }], classify: [] }) as PaConfig;
    const server = createServer(cfg, { dataDir: mkdtempSync(join(tmpdir(), 'pa-hello-')), plugins: [hello], tickMs: 0, snapshotMs: 0, flushMs: 20, fileTailMs: 25, log: () => {} });
    await server.listen();
    try {
      for (const ev of helloAdapter.parse([{ name: 'build', host: 'ci-1', state: 'running', progress: 42 }], ctx)) server.ingest(ev);
      let job: Entity | undefined;
      for (let i = 0; i < 100 && !job; i++) {
        const st = (await (await fetch(`http://127.0.0.1:${server.port}/api/state`)).json()) as { entities: Entity[] };
        job = st.entities.find((e) => e.id === 'job:build');
        if (!job) await new Promise((r) => setTimeout(r, 20));
      }
      expect(job).toMatchObject({ status: 'working', metrics: { progress: 42 }, labels: { host: 'ci-1' }, view: { behavior: 'minion' } });
    } finally {
      await server.close();
    }
  });
});

describe('hello-sepia filter', () => {
  afterEach(() => { delete (globalThis as Record<string, unknown>).__pixelagents; });

  it('is exported and builds a program with the amount uniform (default 0.6, clamped)', () => {
    const seen: Record<string, { value: number }>[] = [];
    class UniformGroup { constructor(public u: Record<string, { value: number }>) { seen.push(u); } }
    class Filter { constructor(public o: unknown) {} }
    (globalThis as Record<string, unknown>).__pixelagents = { pixi: { Filter, UniformGroup, GlProgram: { from: (o: unknown) => o } } };
    expect(Object.keys(client.filters)).toEqual(['hello-sepia']);
    sepia({});
    sepia({ amount: 9 });
    expect(seen.map((u) => u.uAmount!.value)).toEqual([0.6, 1]);
  });

  it('explains itself when the host exposes no pixi', () => {
    expect(() => sepia({})).toThrow(/expose pixi/);
  });
});
