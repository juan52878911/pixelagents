// Every example quoted in docs/plugins.md lives in examples/snippets and is exercised here.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { CONFIG_SCHEMA, DEFAULT_CONFIG, applyRules, mergeConfig, type Entity, type PaConfig } from '@pixelagents/protocol';
import { mapAdapter } from '../../../plugins/map/src/index.js';
import queue, { queueAdapter, queueReducer } from '../queue-plugin.js';
import { tickerInput } from '../ticker-input.js';
import { pace } from '../pace.client.js';
import { columna } from '../column.client.js';
import { makeRng } from '../../../packages/web/src/world/rng.js';
import { registerBehavior, setBehavior, getBehavior } from '../../../packages/web/src/engine/behaviors.js';
import { World } from '../../../packages/web/src/engine/ecs.js';
import { compileFrame } from '../../../packages/web/src/engine/px.js';

const here = dirname(fileURLToPath(import.meta.url));
const json = (f: string): any => JSON.parse(readFileSync(resolve(here, '..', f), 'utf8'));
const validate = (cfg: unknown): { ok: boolean; errors: unknown } => { const a = new Ajv2020({ strict: false, allErrors: true }); return { ok: a.validate(CONFIG_SCHEMA, cfg) as boolean, errors: a.errors }; };
const ctx = (options: Record<string, unknown> = {}) => ({ input: 'x', options, now: () => new Date('2026-01-01T00:00:00Z') });
const ent = (id: string, extra: Partial<Entity> = {}): Entity => ({ id, kind: id.split(':')[0]!, labels: {}, status: 'idle', metrics: {}, firstSeen: '', lastSeen: '', history: [], view: {}, ...extra });

describe('docs snippets', () => {
  it('map source: config validates and the adapter maps a record (and honours `when`)', () => {
    const cfg = json('map-source.config.json');
    const v = validate(mergeConfig(DEFAULT_CONFIG, cfg));
    expect(v.ok, JSON.stringify(v.errors)).toBe(true);
    const opts = cfg.inputs[0].options;
    const [e] = mapAdapter.parse({ status: 'start', job: { id: 7, name: 'build-api' }, elapsed: 12, at: '2026-01-01T00:00:00Z' }, ctx(opts));
    expect(e).toMatchObject({ entity: 'job:7', kind: 'session.start', labels: { name: 'build-api #7', host: 'ci' }, attrs: { duration_s: 12 } });
    expect(mapAdapter.parse({ status: 'start', job: { id: 8, name: 'lint' } }, ctx(opts))).toEqual([]);
  });

  it('rules: later rules win, globs and lists match, hidden is set', () => {
    const cfg = json('rules.config.json');
    expect(validate(mergeConfig(DEFAULT_CONFIG, cfg)).ok).toBe(true);
    const q = applyRules(ent('queue:a', { kind: 'queue', metrics: { depth: 1500 }, labels: { team: 'infra' } }), cfg.classify);
    expect(q.view).toMatchObject({ behavior: 'minion', skin: 'red', group: 'infra' });
    expect(applyRules(ent('queue:b', { kind: 'queue', metrics: { depth: 5 } }), cfg.classify).view.skin).toBeUndefined();
    expect(applyRules(ent('vm:probe-1'), cfg.classify).view.hidden).toBe(true);
  });

  it('adapter + reducer plugin', () => {
    const evs = queueAdapter.parse('queue=emails depth=120 workers=3\njunk\nqueue=x depth=NaN', ctx());
    expect(evs).toHaveLength(1);
    const e = queueReducer.reduce(ent('queue:emails'), evs[0]!, { config: DEFAULT_CONFIG, now: ctx().now, get: () => undefined })!;
    expect(e).toMatchObject({ status: 'working', metrics: { depth: 120, workers: 3 } });
    expect(queue.name).toBe('queue');
  });

  it('InputFactory: pushes on a timer and stops on abort', async () => {
    const got: unknown[] = [];
    const ac = new AbortController();
    tickerInput.start({ everySec: 0.05, line: 'queue=a depth=3' }, (r) => got.push(r), ac.signal);
    await new Promise((r) => setTimeout(r, 180));
    ac.abort();
    const n = got.length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(got[0]).toBe('queue=a depth=3 n=1');
    await new Promise((r) => setTimeout(r, 120));
    expect(got.length).toBe(n);
  });

  it('behavior: paces within +-24 px and flips', () => {
    registerBehavior('pace', pace);
    const w = new World();
    const a = w.create('a');
    a.transform.x = 100;
    a.animator = { time: 0, tag: undefined, playing: false, speed: 1 };
    const bctx = { world: w, width: 480, height: 328, dt: 0.1 };
    expect(setBehavior(a, 'pace', bctx)).toBe(true);
    expect(getBehavior('pace')).toBe(pace);
    pace.enter!(a, bctx);
    let min = 1e9, max = -1e9;
    for (let i = 0; i < 400; i++) { pace.update(a, 0.1, bctx); min = Math.min(min, a.transform.x); max = Math.max(max, a.transform.x); }
    expect(min).toBeGreaterThanOrEqual(76);
    expect(max).toBeLessThanOrEqual(124);
    expect(max - min).toBeGreaterThan(40);
    expect(a.animator.tag).toBe('walk');
  });

  it('strategy: grows the office only into free tiles, deterministically', () => {
    const run = (seed: number): number[][] => {
      const own = Array.from({ length: 30 }, () => Array<number>(40).fill(-1));
      const o = { tx: 10, ty: 10, tw: 8, th: 8, isLab: false };
      for (let r = 10; r < 18; r++) for (let c = 10; c < 18; c++) own[r]![c] = 0;
      columna(o, 0, { own, cols: 40, rows: 30, rg: makeRng(seed), free: (c, r, oi) => own[r]?.[c] === -1 || own[r]?.[c] === oi });
      return own;
    };
    const a = run(1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(run(1)));
    const count = a.flat().filter((x) => x === 0).length;
    expect(count).toBeGreaterThan(64);
  });

  it('sprites: pet.px.json is well formed and compiles', () => {
    const f = json('pet.px.json');
    expect(f.px).toBe(1);
    for (const s of f.sprites) {
      for (const fr of s.frames) {
        expect(fr).toHaveLength(s.h);
        for (const row of fr) {
          expect(row).toHaveLength(s.w);
          for (const ch of row) if (ch !== '.') expect(s.palette[ch], ch).toBeTruthy();
        }
      }
      const px = compileFrame(s, 0);
      expect(px.length).toBe(s.w * s.h * 4);
      expect(px.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
    }
  });

  it('skins: config validates and the rules pick the skin', () => {
    const cfg = json('skins.config.json');
    expect(validate(mergeConfig(DEFAULT_CONFIG, cfg)).ok).toBe(true);
    expect(applyRules(ent('agent:a', { labels: { account: 'work' } }), cfg.classify).view.skin).toBe('ocean');
    expect(applyRules(ent('agent:a', { labels: { account: 'home' } }), cfg.classify).view.skin).toBe('home');
  });

  it('custom input types pass config validation (inputs[].type is open)', () => {
    const cfg = { ...DEFAULT_CONFIG, inputs: [{ id: 't', type: 'ticker', adapter: 'queue', everySec: 2 }] } as unknown as PaConfig;
    const v = validate(cfg);
    expect(v.ok, JSON.stringify(v.errors).slice(0, 300)).toBe(true);
  });
});
