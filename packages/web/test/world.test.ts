import { describe, expect, it } from 'vitest';
import {
  GY, TS, generateWorld, getStrategy, isHall, placementProblem, registerStrategy, relayout, signParts, strategyNames, walkableFn,
  type DecorItem, type GroupInput, type OfficeGeom, type OfficeLayout, type WorldInput, type WorldLayout,
} from '../src/world/index.js';

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

function geomOf(o: OfficeLayout, oi: number): OfficeGeom {
  return {
    oi, tx: o.tx, ty: o.ty, tw: o.tw, th: o.th, deskRows: o.deskRows, rowPitch: o.rowPitch / TS,
    deskX0: o.startX, deskX1: Math.max(o.startX, ...o.zones.flatMap((z) => z.slots).concat(o.capsules).map((s) => s.dx - o.x + 35)),
    racks: o.racks ? { c0: 0, c1: Math.floor((6 + o.racks * 16 - 5) / TS), r0: 2, r1: 5 } : null, entry: o.entry,
  };
}

/** Every invariant of a town (style of design/prototype/check-world.cjs). */
function check(w: WorldLayout): string[] {
  const errs: string[] = [];
  const mapW = w.cols * TS, mapH = GY + w.rows * TS;
  const path = new Set(w.path);
  const own = w.own;
  const at = (c: number, r: number): number => (own[r] && c >= 0 && c < w.cols ? own[r]![c]! : -1);
  if (w.rows < 38 || own.length !== w.rows) errs.push('filas');
  for (const row of own) for (const v of row) if (v < -1 || v >= w.offices.length) errs.push('dueno invalido');
  w.offices.forEach((o, oi) => {
    const nm = o.id;
    if (o.x < 0 || o.x + o.w > mapW || o.y < GY || o.y + o.h > mapH) errs.push(nm + ' fuera del mapa');
    for (let r = o.ty; r < o.ty + o.th - 1; r++) for (let c = o.tx; c < o.tx + o.tw; c++) if (at(c, r) !== oi) errs.push(nm + ' sala rota');
    if (!path.has(o.doorTile[1] * w.cols + o.doorTile[0])) errs.push(nm + ' puerta sin camino');
    if (at(o.doorTile[0], o.doorTile[1]) !== -1) errs.push(nm + ' puerta tapada');
    if (o.door + 12 > o.w) errs.push(nm + ' puerta fuera de la fachada');
    if (5 + signParts(o.label, o.kind).width + 6 > o.door) errs.push(nm + ' cartel pisa la puerta');
    const owned = new Set<number>();
    for (let r = 0; r < w.rows; r++) for (let c = 0; c < w.cols; c++) if (at(c, r) === oi) owned.add(r * w.cols + c);
    if (o.tiles.length !== owned.size || o.tiles.some((t) => !owned.has(t[1] * w.cols + t[0]))) errs.push(nm + ' tiles no coinciden');
    if (o.order.length !== owned.size || o.order.some((t) => !owned.has(t[1] * w.cols + t[0]))) errs.push(nm + ' orden no cubre la oficina');
    // shape: 2×2 blocks, 4-connected to the hall, a tile of grass from other offices
    const blk = (c: number, r: number): boolean => at(c, r) === oi && at(c + 1, r) === oi && at(c, r + 1) === oi && at(c + 1, r + 1) === oi;
    for (const [c, r] of o.tiles) {
      if (!isHall(geomOf(o, oi), c, r) && !(blk(c, r) || blk(c - 1, r) || blk(c, r - 1) || blk(c - 1, r - 1))) errs.push(nm + ' pico de 1 tile');
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const v = at(c + dc, r + dr); if (v !== -1 && v !== oi) errs.push(nm + ' pegada a otra oficina'); }
    }
    const seen = new Set<number>(), q = [[o.tx, o.ty]];
    seen.add(o.ty * w.cols + o.tx);
    for (let i = 0; i < q.length; i++) for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const c = q[i]![0]! + dc, r = q[i]![1]! + dr, k = r * w.cols + c;
      if (at(c, r) === oi && !seen.has(k)) { seen.add(k); q.push([c, r]); }
    }
    if (seen.size !== owned.size) errs.push(nm + ' ala desconectada');
    // furniture: inside, on floor, no overlap, against a wall, corridors free (the rules themselves)
    const g = geomOf(o, oi);
    if (!walkableFn(own, g, [])(o.entry[0], o.entry[1])) errs.push(nm + ' entrada bloqueada');
    for (const d of o.decor) { const p = placementProblem(own, g, d, o.decor); if (p) errs.push(nm + ' mueble ' + d.id + ': ' + p); }
    for (const d of o.wallDeco) if (d.x < o.x || d.x + d.w > o.x + o.w || d.y < o.y + 2 || d.y + d.h > o.y + 15) errs.push(nm + ' deco de pared fuera de la fachada');
    for (const wx of o.windows) if (wx + 22 > o.w || wx < o.door + 12) errs.push(nm + ' ventana fuera');
    if (o.poster != null && (o.poster + 12 > o.w || o.poster < o.door + 12)) errs.push(nm + ' poster fuera');
    for (const z of o.zones) for (const s of z.slots) if (s.dx < o.x + o.startX || s.dx + 34 > o.x + o.w - 24 || s.dy < o.y + 58 || s.dy > o.y + o.h - 30) errs.push(nm + ' hueco fuera de la sala');
    for (const s of o.capsules) if (s.dx < o.x + o.startX || s.dx + 34 > o.x + o.w - 24) errs.push(nm + ' capsula fuera de la sala');
    for (const z of o.zones) { const f = z.slots.filter((s) => !s.agent).length; if (f < 1 || f > 3) errs.push(nm + ' sin hueco libre'); }
    if (o.capsules.length) { const f = o.capsules.filter((s) => !s.agent).length; if (f < 1 || f > 3) errs.push(nm + ' capsulas sin hueco'); }
    if (o.changed && o.doneAt < 0) errs.push(nm + ' cambiada sin obra');
    if (!o.changed && o.doneAt >= 0) errs.push(nm + ' obra sin cambio');
  });
  if (!connected(w)) errs.push('puertas desconectadas de la red');
  for (const k of w.path) if (at(k % w.cols, Math.floor(k / w.cols)) !== -1) errs.push('camino sobre una oficina');
  for (const t of w.trees) if (at(t.c, t.r) !== -1 || path.has(t.r * w.cols + t.c)) errs.push('arbol sobre camino u oficina');
  for (const b of w.bushes) if (at(b.c, b.r) !== -1 || path.has(b.r * w.cols + b.c)) errs.push('arbusto sobre camino u oficina');
  const rev = new Set(w.build.reveal.filter((r) => r.kind === 'office').map((r) => `${r.x},${r.y}`));
  for (const o of w.offices) for (const [c, r] of o.tiles) { const has = rev.has(`${c * TS},${GY + r * TS}`); if (has !== o.changed) errs.push(o.id + (has ? ' obra sin cambio' : ' tile sin obra')); }
  return [...new Set(errs)];
}

/** Offices present in both layouts and not rebuilt in `b` must be identical in `b` (`except`: the ones whose input changed). */
function stable(a: WorldLayout, b: WorldLayout, except: string[] = []): string[] {
  const errs: string[] = [];
  const newEpoch = a.epoch !== b.epoch;
  for (const pa of a.offices) {
    const pb = b.offices.find((o) => o.id === pa.id);
    if (!pb) continue;
    if (except.includes(pa.id)) { if (!newEpoch && pb.changed !== pa.changed) errs.push(pa.id + ' cambio sin epoca nueva'); continue; }
    if (pb.changed && newEpoch) { errs.push(pa.id + ' reconstruida sin motivo'); continue; }
    if ([pa.tx, pa.ty, pa.tw, pa.th, pa.door, pa.strategy].join() !== [pb.tx, pb.ty, pb.tw, pb.th, pb.door, pb.strategy].join()) errs.push(pa.id + ' se movio');
    if (JSON.stringify(pa.tiles) !== JSON.stringify(pb.tiles)) errs.push(pa.id + ' cambio de forma');
    if (JSON.stringify([pa.decor, pa.wallDeco, pa.windows, pa.poster]) !== JSON.stringify([pb.decor, pb.wallDeco, pb.windows, pb.poster])) errs.push(pa.id + ' cambio de muebles');
    for (const za of pa.zones) {
      const zb = pb.zones.find((z) => z.id === za.id);
      if (!zb) continue;
      for (const s of za.slots) if (s.agent && zb.slots.some((t) => t.agent === s.agent) && !zb.slots.some((t) => t.agent === s.agent && t.dx === s.dx && t.dy === s.dy)) errs.push(pa.id + ' ' + s.agent + ' cambio de mesa');
    }
  }
  return [...new Set(errs)];
}

const addAgent = (gs: GroupInput[], gid: string, zi: number, id: string): GroupInput[] =>
  gs.map((g) => (g.id === gid ? (g.pods ? { ...g, pods: [...g.pods, id] } : { ...g, zones: g.zones.map((z, i) => (i === zi ? { ...z, agents: [...z.agents, id] } : z)) }) : g));
const dropAgent = (gs: GroupInput[], gid: string, id: string): GroupInput[] =>
  gs.map((g) => (g.id === gid ? { ...g, ...(g.pods ? { pods: g.pods.filter((p) => p !== id) } : {}), zones: g.zones.map((z) => ({ ...z, agents: z.agents.filter((a) => a !== id) })) } : g));
const addZone = (gs: GroupInput[], gid: string, zid: string, agents: string[]): GroupInput[] =>
  gs.map((g) => (g.id === gid ? { ...g, zones: [...g.zones, { id: zid, label: zid.toUpperCase(), agents }] } : g));

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

  it('handles edge sizes: empty, one empty office, 12 full offices, narrow map, long names', () => {
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
    const long = generateWorld({ seed: 'l', groups: [{ id: 'h', kind: 'workstation', label: 'mac-studio-de-juan-en-la-oficina-del-fondo', zones: [{ id: 'z', label: 'un-repositorio-con-nombre-kilometrico', agents: ['a'] }] }], decor: DECOR });
    expect(check(long)).toEqual([]);
    expect(signParts(long.offices[0]!.label, 'workstation').label.endsWith('…')).toBe(true);
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
    const groups = randomGroups(2, 5);
    const input: WorldInput = { seed: '2026-01-15', groups, decor: DECOR };
    const target = groups.find((g) => g.kind !== 'lab' && g.zones[0]!.agents.length > 0)!;
    const gone = target.zones[0]!.agents[0]!;
    const first = generateWorld(input);
    // one leaves (2 free desks): nothing moves, the desk stays free
    const prev = relayout(first, { ...input, groups: dropAgent(groups, target.id, gone) });
    expect(prev.epoch).toBe(first.epoch);
    expect(stable(first, prev)).toEqual([]);
    const next: WorldInput = { ...input, groups: addAgent(dropAgent(groups, target.id, gone), target.id, 0, 'newbie') };
    const out = relayout(prev, next);
    expect(out.own).toEqual(prev.own);
    expect(out.path).toEqual(prev.path);
    expect(out.epoch).toBe(prev.epoch);
    expect(stable(prev, out)).toEqual([]);
    const no = out.offices.find((o) => o.id === target.id)!;
    expect(no.zones.find((z) => z.id === target.zones[0]!.id)!.slots.some((s) => s.agent === 'newbie')).toBe(true);
    expect(JSON.stringify(relayout(out, next))).toBe(JSON.stringify(out));
  });

  it('grows and shrinks incrementally: other offices never move, demolition and building are scheduled', () => {
    const fails: string[] = [];
    for (let seed = 0; seed < 60; seed++) {
      const rnd = lcg(seed * 31 + 7);
      let groups = randomGroups(seed + 100, 2 + Math.floor(rnd() * 5));
      const day = dayKey(seed % 40);
      let w = generateWorld({ seed: day, groups, decor: DECOR });
      let errs = check(w);
      if (errs.length) fails.push(`seed${seed} inicio: ${errs.slice(0, 3).join(' | ')}`);
      for (let step = 0; step < 6; step++) {
        const op = Math.floor(rnd() * 5);
        const office = groups[Math.floor(rnd() * groups.length)];
        let label = '';
        if (op === 0 && office) { label = 'nuevo agente'; groups = addAgent(groups, office.id, 0, `n${seed}-${step}`); }
        else if (op === 1 && office && !office.pods) { label = 'zona nueva'; groups = addZone(groups, office.id, `nz${seed}-${step}`, [`z${seed}-${step}-a`, `z${seed}-${step}-b`]); }
        else if (op === 2 && office) { label = 'se va un agente'; const all = [...(office.pods ?? []), ...office.zones.flatMap((z) => z.agents)]; if (all.length) groups = dropAgent(groups, office.id, all[Math.floor(rnd() * all.length)]!); }
        else if (op === 3 && groups.length < 12) { label = 'oficina nueva'; groups = [...groups, ...randomGroups(seed * 10 + step, 1).map((g) => ({ ...g, id: `new${seed}-${step}`, label: `NEW${step}` }))]; }
        else if (office) { label = 'oficina demolida'; groups = groups.filter((g) => g !== office); }
        const before = w;
        w = relayout(w, { seed: day, groups, decor: DECOR });
        errs = [...check(w), ...stable(before, w, office ? [office.id] : [])];
        if (errs.length) fails.push(`seed${seed} paso${step} (${label}): ${errs.slice(0, 3).join(' | ')}`);
        // every tile that stops belonging to its office is demolished; every new tile is built
        const bk = (o: OfficeLayout) => new Set(o.tiles.map((t) => t.join()));
        for (const po of before.offices) {
          const no = w.offices.find((o) => o.id === po.id);
          if (w.epoch === before.epoch || (no && !no.changed)) continue;
          const dem = new Set(w.build.demolish.filter((r) => r.kind === 'office').map((r) => `${r.x / TS},${(r.y - GY) / TS}`));
          for (const t of bk(po)) if (!dem.has(t)) { fails.push(`seed${seed} paso${step}: ${po.id} tile ${t} sin demoler`); break; }
          if (!w.build.crews.some((c) => c.kind === 'demolish' && c.id === po.id)) fails.push(`seed${seed} paso${step}: ${po.id} sin cuadrilla de derribo`);
        }
        if (w.epoch !== before.epoch) expect(w.build.buildEnd).toBeGreaterThan(0);
        if (JSON.stringify(relayout(w, { seed: day, groups, decor: DECOR })) !== JSON.stringify(w)) fails.push(`seed${seed} paso${step}: relayout no es idempotente`);
      }
    }
    expect(fails.slice(0, 8)).toEqual([]);
  });

  it('an office that outgrows its hall is rebuilt in place when there is room', () => {
    const groups: GroupInput[] = [
      { id: 'a', kind: 'office', label: 'A', zones: [{ id: 'z', label: 'Z', agents: ['a1'] }] },
      { id: 'b', kind: 'office', label: 'B', zones: [{ id: 'z', label: 'Z', agents: ['b1', 'b2'] }] },
    ];
    const w0 = generateWorld({ seed: '2026-02-02', groups, decor: DECOR });
    let gs = groups;
    for (let i = 2; i < 8; i++) gs = addAgent(gs, 'a', 0, `a${i}`);
    const w1 = relayout(w0, { seed: '2026-02-02', groups: gs, decor: DECOR });
    const a0 = w0.offices.find((o) => o.id === 'a')!, a1 = w1.offices.find((o) => o.id === 'a')!;
    expect(check(w1)).toEqual([]);
    expect(stable(w0, w1, ['a'])).toEqual([]);
    expect(a1.changed).toBe(true);
    expect(a1.tw).toBeGreaterThan(a0.tw);
    expect(w1.build.crews.map((c) => c.kind).sort()).toEqual(['build', 'demolish']);
    // shrink back: the office is rebuilt smaller in the same place
    const w2 = relayout(w1, { seed: '2026-02-02', groups, decor: DECOR });
    const a2 = w2.offices.find((o) => o.id === 'a')!;
    expect(check(w2)).toEqual([]);
    expect(a2.changed).toBe(true);
    expect(a2.tw).toBeLessThan(a1.tw);
    expect([a2.tx, a2.ty]).toEqual([a1.tx, a1.ty]);
  });

  it('generates in < 80 ms p95 with 12 offices', () => {
    const groups = randomGroups(9, 12);
    const times: number[] = [];
    for (let d = 0; d < 40; d++) {
      const t0 = performance.now();
      generateWorld({ seed: dayKey(d), groups, decor: DECOR });
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    console.log(`world 12 offices: p50=${times[20]!.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${times[times.length - 1]!.toFixed(1)}ms`);
    expect(p95).toBeLessThan(80);
  });
});
