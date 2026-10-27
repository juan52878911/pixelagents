import { describe, expect, it } from 'vitest';
import { generateWorld, getStrategy, registerStrategy, relayout, strategyNames } from '../src/world/index.js';
import type { DecorItem, GroupInput, WorldInput, WorldLayout } from '../src/world/index.js';

const DECOR: DecorItem[] = [
  { id: 'poster-a', w: 12, h: 10, place: 'wall' },
  { id: 'clock', w: 8, h: 8, place: 'wall' },
  { id: 'statue', w: 12, h: 18, place: 'floor' },
  { id: 'fountain', w: 20, h: 14, place: 'floor' },
];

function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
}

/** Random set of groups: 1-12 offices, 0-12 agents each, mixed kinds. */
function randomGroups(seed: number, forceN?: number): GroupInput[] {
  const rnd = lcg(seed * 7919 + 13);
  const n = forceN ?? 1 + Math.floor(rnd() * 12);
  const kinds = ['office', 'lab', 'server', 'office'];
  return Array.from({ length: n }, (_, i): GroupInput => {
    const kind = kinds[Math.floor(rnd() * kinds.length)]!;
    const id = `g${i}`;
    const count = Math.floor(rnd() * 13);
    if (kind === 'lab') return { id, kind, label: `LAB-${i}`, zones: [], pods: Array.from({ length: count }, (_, k) => `${id}-p${k}`) };
    const nz = count === 0 ? 1 : 1 + Math.floor(rnd() * Math.min(3, count));
    const zones = Array.from({ length: nz }, (_, z) => ({ id: `${id}-z${z}`, label: `REPO${z}`, agents: [] as string[] }));
    for (let k = 0; k < count; k++) zones[k % nz]!.agents.push(`${id}-a${k}`);
    return { id, kind, label: `${kind.toUpperCase()}-${i}`, zones };
  });
}

function dayKey(d: number): string {
  const t = new Date(Date.UTC(2026, 0, 15 + d));
  return t.toISOString().slice(0, 10);
}

function connected(w: WorldLayout): boolean {
  const path = new Set(w.path);
  const start = w.plazaOk ? w.plaza[1] * w.cols + w.plaza[0] : w.path[0]!;
  const seen = new Set([start]);
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const k = q[i]!, c = k % w.cols, r = Math.floor(k / w.cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= w.cols) continue;
      const kk = rr * w.cols + cc;
      if (path.has(kk) && !seen.has(kk)) { seen.add(kk); q.push(kk); }
    }
  }
  return w.offices.every((o) => o.doorTile[1] < 0 || seen.has(o.doorTile[1] * w.cols + o.doorTile[0]));
}

function check(w: WorldLayout): string[] {
  const errs: string[] = [];
  const mapW = w.cols * 8, mapH = 24 + w.rows * 8;
  const path = new Set(w.path);
  w.offices.forEach((o, oi) => {
    const nm = o.id;
    if (o.x < 0 || o.x + o.w > mapW || o.y < 24 || o.y + o.h > mapH) errs.push(nm + ' fuera del mapa');
    for (let r = o.ty; r < o.ty + o.th - 1; r++) for (let c = o.tx; c < o.tx + o.tw; c++) if (w.own[r]![c] !== oi) errs.push(nm + ' sala rota');
    if (!path.has(o.doorTile[1] * w.cols + o.doorTile[0])) errs.push(nm + ' puerta sin camino');
    if (o.order.length < o.tw * (o.th - 1)) errs.push(nm + ' orden de obra corto');
    const owned = new Set<number>();
    for (let r = 0; r < w.rows; r++) for (let c = 0; c < w.cols; c++) if (w.own[r]![c] === oi) owned.add(r * w.cols + c);
    if (o.order.some((t) => !owned.has(t[1] * w.cols + t[0]))) errs.push(nm + ' orden fuera de la oficina');
    if (o.order.length !== owned.size) errs.push(nm + ' orden no cubre la oficina ' + o.order.length + '/' + owned.size);
    for (const d of o.decor) {
      if (d.y < o.y) errs.push(nm + ' deco por encima');
      for (const [px, py] of [[d.x, d.y], [d.x + d.w - 1, d.y + d.h - 1]] as const) {
        if (!owned.has(Math.floor((py - 24) / 8) * w.cols + Math.floor(px / 8))) errs.push(nm + ' deco fuera de su oficina');
      }
    }
    for (const z of o.zones) for (const s of z.slots) if (s.dx < o.x || s.dx + 34 > o.x + o.w + 4) errs.push(nm + ' hueco fuera de la sala');
    // capacity: every zone keeps one free slot
    for (const z of o.zones) if (z.slots.filter((s) => !s.agent).length !== 1) errs.push(nm + ' sin hueco libre');
    if (o.capsules.length && o.capsules.filter((s) => !s.agent).length !== 1) errs.push(nm + ' capsulas sin hueco');
  });
  if (!connected(w)) errs.push('puertas desconectadas de la red');
  // no tile shared and every owner index is valid
  for (const row of w.own) for (const v of row) if (v < -1 || v >= w.offices.length) errs.push('dueno invalido');
  return [...new Set(errs)];
}

describe('world generator', () => {
  it('invariants over 60 days x 5 random group sets', () => {
    const fails: string[] = [];
    const strat: Record<string, number> = {};
    for (let set = 0; set < 5; set++) {
      const groups = randomGroups(set + 1);
      for (let d = -30; d < 30; d++) {
        const w = generateWorld({ seed: dayKey(d), groups, decor: DECOR });
        for (const o of w.offices) strat[o.strategy] = (strat[o.strategy] ?? 0) + 1;
        const errs = check(w);
        if (errs.length) fails.push(`set${set} ${dayKey(d)} (${groups.length} of): ${errs.slice(0, 3).join(' | ')}`);
      }
    }
    expect(fails.slice(0, 5)).toEqual([]);
    expect(Object.keys(strat).sort()).toEqual(['alas', 'cueva', 'escalera', 'mancha', 'mordida']);
  });

  it('handles edge sizes: empty, one empty office, 12 full offices, narrow map', () => {
    expect(generateWorld({ seed: '2026-01-15', groups: [], decor: [] }).offices).toEqual([]);
    const one = generateWorld({ seed: 'x', groups: [{ id: 'a', kind: 'office', label: 'A', zones: [] }], decor: [] });
    expect(check(one)).toEqual([]);
    const full: GroupInput[] = Array.from({ length: 12 }, (_, i) => ({
      id: `g${i}`, kind: 'office', label: `O${i}`, zones: [{ id: `z${i}`, label: 'R', agents: Array.from({ length: 12 }, (_, k) => `a${i}-${k}`) }],
    }));
    const w = generateWorld({ seed: '2026-03-03', groups: full, decor: DECOR });
    expect(check(w)).toEqual([]);
    expect(w.rows).toBeGreaterThan(38);
    const narrow = generateWorld({ seed: 'n', groups: randomGroups(3, 4), decor: DECOR, cols: 40 });
    expect(check(narrow)).toEqual([]);
  });

  it('is deterministic bit by bit', () => {
    for (let set = 0; set < 3; set++) {
      const input: WorldInput = { seed: dayKey(set), groups: randomGroups(set + 20), decor: DECOR };
      expect(JSON.stringify(generateWorld(input))).toBe(JSON.stringify(generateWorld(JSON.parse(JSON.stringify(input)))));
    }
    const a = generateWorld({ seed: '2026-01-15', groups: randomGroups(1), decor: [] });
    const b = generateWorld({ seed: '2026-01-16', groups: randomGroups(1), decor: [] });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('strategies are pluggable and selectable', () => {
    expect(strategyNames().sort()).toEqual(['alas', 'cueva', 'escalera', 'mancha', 'mordida']);
    const w = generateWorld({ seed: 's', groups: randomGroups(5, 6), decor: [], strategies: ['mordida'] });
    expect(new Set(w.offices.map((o) => o.strategy))).toEqual(new Set(['mordida']));
    let called = 0;
    registerStrategy('nada', () => { called++; });
    expect(getStrategy('nada')).toBeDefined();
    const w2 = generateWorld({ seed: 's', groups: randomGroups(5, 6), decor: [], strategies: ['nada'] });
    expect(called).toBe(6);
    expect(check(w2)).toEqual([]);
  });

  it('relayout: a newcomer takes the free slot without moving anything', () => {
    const groups = randomGroups(2, 5).map((g) => (g.zones[0] ? g : g));
    const input: WorldInput = { seed: '2026-01-15', groups, decor: DECOR };
    const prev = generateWorld(input);
    const target = groups.find((g) => g.kind !== 'lab')!;
    const next: WorldInput = { ...input, groups: groups.map((g) => (g === target ? { ...g, zones: g.zones.map((z, i) => (i === 0 ? { ...z, agents: [...z.agents, 'newbie'] } : z)) } : g)) };
    const out = relayout(prev, next);
    expect(out.own).toEqual(prev.own);
    expect(out.path).toEqual(prev.path);
    expect(out.offices.map((o) => [o.x, o.y, o.tw, o.strategy, o.decor])).toEqual(prev.offices.map((o) => [o.x, o.y, o.tw, o.strategy, o.decor]));
    const po = prev.offices.find((o) => o.id === target.id)!, no = out.offices.find((o) => o.id === target.id)!;
    for (const [zi, z] of po.zones.entries()) {
      for (const [si, s] of z.slots.entries()) {
        const ns = no.zones[zi]!.slots[si]!;
        expect(ns.dx).toBe(s.dx);
        if (s.agent) expect(ns.agent).toBe(s.agent);
      }
    }
    expect(no.zones[0]!.slots.some((s) => s.agent === 'newbie')).toBe(true);
    // idempotent
    expect(JSON.stringify(relayout(out, next))).toBe(JSON.stringify(out));
  });

  it('relayout: a full zone or a new office re-layouts keeping order and desk assignment order', () => {
    const groups: GroupInput[] = [
      { id: 'a', kind: 'office', label: 'ALFA', zones: [{ id: 'a1', label: 'R1', agents: ['x1', 'x2', 'x3'] }, { id: 'a2', label: 'R2', agents: ['y1'] }] },
      { id: 'b', kind: 'server', label: 'BETA', zones: [{ id: 'b1', label: 'R', agents: ['s1', 's2'] }] },
      { id: 'c', kind: 'lab', label: 'GAMMA', zones: [], pods: ['p1', 'p2'] },
    ];
    const input: WorldInput = { seed: '2026-02-02', groups, decor: DECOR };
    const prev = generateWorld(input);
    // fill the free slot, then add one more -> no free slot -> relayout
    const step1 = relayout(prev, { ...input, groups: [{ ...groups[0]!, zones: [{ ...groups[0]!.zones[0]!, agents: ['x1', 'x2', 'x3', 'x4'] }, groups[0]!.zones[1]!] }, groups[1]!, groups[2]!] });
    const step2In: WorldInput = { ...input, groups: [{ ...groups[0]!, zones: [{ ...groups[0]!.zones[0]!, agents: ['x1', 'x2', 'x3', 'x4', 'x5'] }, groups[0]!.zones[1]!] }, groups[1]!, groups[2]!, { id: 'd', kind: 'office', label: 'DELTA', zones: [{ id: 'd1', label: 'R', agents: ['q1'] }] }] };
    const step2 = relayout(step1, step2In);
    expect(check(step2)).toEqual([]);
    const ids = (w: WorldLayout) => w.offices.map((o) => o.id);
    expect(ids(step2).slice(0, 3)).toEqual(ids(step1));
    const seatOrder = (w: WorldLayout, off: string, z: string) => w.offices.find((o) => o.id === off)!.zones.find((x) => x.id === z)!.slots.flatMap((s) => (s.agent ? [s.agent] : []));
    expect(seatOrder(step2, 'a', 'a1')).toEqual(['x1', 'x2', 'x3', 'x4', 'x5']);
    expect(seatOrder(step2, 'b', 'b1')).toEqual(['s1', 's2']);
    expect(step2.offices.find((o) => o.id === 'c')!.capsules.flatMap((s) => (s.agent ? [s.agent] : []))).toEqual(['p1', 'p2']);
    // office order in the packing is preserved
    expect(step2.order.offices.slice(0, 3)).toEqual(prev.order.offices);
    // zone order within an office is preserved
    expect(Object.keys(step2.order.agents).filter((k) => k.startsWith('a/'))).toEqual(Object.keys(prev.order.agents).filter((k) => k.startsWith('a/')));
    // removing an agent and re-running keeps the same geometry
    const step3 = relayout(step2, { ...step2In, groups: step2In.groups.map((g) => (g.id === 'a' ? { ...g, zones: [{ ...g.zones[0]!, agents: ['x1', 'x3', 'x4', 'x5'] }, g.zones[1]!] } : g)) });
    expect(step3.own).toEqual(step2.own);
    expect(seatOrder(step3, 'a', 'a1')).toEqual(['x1', 'x3', 'x4', 'x5']);
  });

  it('generates in < 50 ms p95 with 12 offices', () => {
    const times: number[] = [];
    const groups = randomGroups(9, 12);
    for (let i = 0; i < 5; i++) generateWorld({ seed: dayKey(i), groups, decor: DECOR }); // warm-up
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      generateWorld({ seed: dayKey(i), groups, decor: DECOR });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.log(`world 12 offices: p50=${times[50]!.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${times[99]!.toFixed(1)}ms`);
    expect(p95).toBeLessThan(50);
  });
});
