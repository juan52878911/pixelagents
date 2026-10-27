import { makeRng, shuffle, strHash } from './rng.js';
import type { Rng } from './rng.js';
import { SEASONS, seasonFromSeed } from './seasons.js';
import { getStrategy, POOL_LAB, POOL_OFFICE } from './strategies.js';
import type { GrowCtx, OfficeDraft } from './strategies.js';
import { DEFAULT_COLS, GY, TS } from './types.js';
import type {
  BuilderPath, DecorItem, FloorKind, GroupInput, Hints, OfficeLayout, PlacedDecor, RevealItem, Slot, Tile,
  WorldInput, WorldLayout, ZoneLayout,
} from './types.js';

const SLOT_PITCH = 30;
const ROW_PITCH = 40; // px between desk rows (5 tiles)
const BASE_TH = 13;
const MARGIN = 3; // columns kept free on each side of the shelves
const EDGE = 2; // outermost columns where nothing grows, so side highways never close
const D4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DECO_SIZE: Record<string, [number, number]> = {
  plant: [8, 12], sofa: [34, 11], cooler: [7, 17], table: [16, 10], shelf: [12, 16], lamp: [5, 16],
};
const WALLS: Record<FloorKind, string> = { parquet: '#e8d9bf', carpet: '#b9c4d6', server: '#3a404c', lab: '#24323d' };

interface SlotDraft { rel: number; row: number; agent: string | null }
interface Draft extends OfficeDraft {
  id: string; kind: string; label: string; floor: FloorKind; wall: string; racks: number;
  signEnd: number; door: number; deskRows: number; strategy: string;
  zones: { id: string; label: string; slots: SlotDraft[] }[];
  capsules: SlotDraft[];
  x: number; y: number; w: number; h: number; doorTile: Tile;
}

const txtW = (s: string): number => s.length * 4;

/** One office: its content decides the size of its main hall. */
function makeDraft(g: GroupInput, cols: number, rg: Rng, hints: Hints | undefined, enabled: boolean): Draft {
  const isLab = g.kind === 'lab' || g.pods !== undefined;
  const floor: FloorKind = g.kind === 'server' ? 'server' : isLab ? 'lab' : rg.f() < 0.5 ? 'parquet' : 'carpet';
  const racks = g.kind === 'server' ? 2 : 0;
  const signEnd = 5 + txtW(g.label + ' · ' + g.kind) + 6;
  const door = signEnd + 6 + rg.i(0, 12);
  const o: Draft = {
    id: g.id, kind: g.kind, label: g.label, isLab, floor, wall: WALLS[floor], racks, signEnd, door, deskRows: 1,
    strategy: '', zones: [], capsules: [], tx: 0, ty: 0, tw: 0, th: BASE_TH, x: 0, y: 0, w: 0, h: 0, doorTile: [0, 0],
  };
  const maxCur = (cols - 2 * MARGIN) * TS - 30;
  const startX = 12 + (racks ? racks * 16 + 4 : 0);
  let cur = startX, row = 0, maxUsed = startX;
  const place = (n: number): SlotDraft[] => {
    const need = (n - 1) * SLOT_PITCH + 34 + 6;
    if (cur + need > maxCur && cur > startX) { row++; cur = startX; }
    const slots: SlotDraft[] = [];
    for (let k = 0; k < n; k++) {
      if (cur + 5 + k * SLOT_PITCH + 34 > maxCur && k > 0) { // zone too long for a row: continue below
        const used = k;
        row++; cur = startX - used * SLOT_PITCH;
      }
      slots.push({ rel: cur + 5 + k * SLOT_PITCH, row, agent: null });
      maxUsed = Math.max(maxUsed, cur + k * SLOT_PITCH + 34 + 6);
    }
    const last = slots[n - 1]!;
    cur = last.rel - 5 + 34 + 6;
    maxUsed = Math.max(maxUsed, cur);
    return slots;
  };
  // repos swap places every day (hints keep the previous order)
  const order = shuffle(g.zones.map((_, i) => i), rg);
  const prevKeys = enabled ? Object.keys(hints?.agents ?? {}).filter((k) => k.startsWith(g.id + '/')) : [];
  if (prevKeys.length) {
    const rank = (i: number): number => { const z = g.zones[i]!; const p = prevKeys.indexOf(g.id + '/' + z.id); return p < 0 ? 1e6 + i : p; };
    order.sort((a, b) => rank(a) - rank(b));
  }
  for (const zi of order) {
    const z = g.zones[zi]!;
    const prev = (enabled && hints?.agents?.[g.id + '/' + z.id]) || [];
    const agents = uniq(z.agents);
    const ordered = [...prev.filter((a) => agents.includes(a)), ...agents.filter((a) => !prev.includes(a))];
    const slots = place(ordered.length + 1);
    ordered.forEach((a, k) => { slots[k]!.agent = a; });
    o.zones.push({ id: z.id, label: z.label, slots });
  }
  if (g.pods !== undefined) {
    const pods = uniq(g.pods);
    const prev = (enabled && hints?.agents?.[g.id + '/@pods']) || [];
    const ordered = [...prev.filter((a) => pods.includes(a)), ...pods.filter((a) => !prev.includes(a))];
    const slots = place(ordered.length + 1);
    ordered.forEach((a, k) => { slots[k]!.agent = a; });
    o.capsules = slots;
  }
  o.deskRows = row + 1;
  o.th = BASE_TH + (o.deskRows - 1) * (ROW_PITCH / TS);
  o.tw = Math.min(cols - 2 * MARGIN, Math.max(Math.ceil((maxUsed + 30) / TS), Math.ceil((door + 16) / TS), 12));
  o.door = Math.min(o.door, o.tw * TS - 14);
  return o;
}

function uniq(a: string[]): string[] { return [...new Set(a)]; }

export function generateWorld(input: WorldInput, hints?: Hints): WorldLayout {
  const cols = Math.max(24, input.cols ?? DEFAULT_COLS);
  const rg = makeRng(strHash(input.seed));
  const season = input.season && SEASONS[input.season] ? input.season : seasonFromSeed(input.seed);
  const S = SEASONS[season]!;
  const useHints = !!hints;
  const groups = input.groups.filter((g, i, a) => a.findIndex((x) => x.id === g.id) === i).slice(0, 12);
  const offs: Draft[] = groups.map((g) => makeDraft(g, cols, rg, hints, useHints));
  const n = offs.length;

  // ---- pack offices into shelves (rows) ----
  let packOrder = shuffle(offs.map((_, i) => i), rg);
  if (hints?.offices?.length) {
    const rank = (i: number): number => { const p = hints.offices!.indexOf(offs[i]!.id); return p < 0 ? 1e6 + i : p; };
    packOrder = offs.map((_, i) => i).sort((a, b) => rank(a) - rank(b));
  }
  const shelves: number[][] = [];
  {
    let row: number[] = [], sum = 0;
    for (const oi of packOrder) {
      const tw = offs[oi]!.tw;
      if (row.length && sum + tw + row.length + 2 > cols - 2 * MARGIN) { shelves.push(row); row = []; sum = 0; }
      row.push(oi); sum += tw;
    }
    if (row.length) shelves.push(row);
  }
  shelves.forEach((r) => { if (rg.f() < 0.5) r.reverse(); });
  let rowTop = rg.i(1, 2), maxBottom = 0;
  shelves.forEach((row, si) => {
    const sumTw = row.reduce((s, oi) => s + offs[oi]!.tw, 0);
    let spare = Math.max(0, cols - 2 * MARGIN - sumTw - (row.length - 1));
    let x = MARGIN + rg.i(0, spare);
    spare -= x - MARGIN;
    let bottom = 0;
    row.forEach((oi, k) => {
      const o = offs[oi]!;
      o.tx = x;
      o.ty = rowTop + rg.i(0, 2);
      bottom = Math.max(bottom, o.ty + o.th);
      const gap = k < row.length - 1 ? 1 + rg.i(0, spare) : 0;
      spare -= Math.max(0, gap - 1);
      x += o.tw + gap;
    });
    maxBottom = Math.max(maxBottom, bottom);
    rowTop = bottom + 5 + rg.i(0, 3);
    void si;
  });
  const rows = Math.max(38, maxBottom + 10);

  // ---- ownership grid ----
  const own: number[][] = [];
  for (let r = 0; r < rows; r++) own.push(new Array<number>(cols).fill(-1));
  const reserved = new Set<number>();
  const K = (c: number, r: number): number => r * cols + c;
  offs.forEach((o, oi) => {
    o.x = o.tx * TS; o.y = GY + o.ty * TS; o.w = o.tw * TS; o.h = o.th * TS;
    for (let r = o.ty; r < o.ty + o.th; r++) for (let c = o.tx; c < o.tx + o.tw; c++) own[r]![c] = oi;
    o.doorTile = [Math.floor((o.x + o.door + 5) / TS), o.ty - 1];
    if (o.ty - 1 >= 0) reserved.add(K(o.doorTile[0], o.ty - 1));
    if (o.ty - 2 >= 0) reserved.add(K(o.doorTile[0], o.ty - 2));
  });
  const free = (c: number, r: number, oi: number): boolean => {
    if (c < EDGE || r < 0 || c >= cols - EDGE || r >= rows || own[r]![c] !== -1 || reserved.has(K(c, r))) return false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && own[rr]![cc] !== -1 && own[rr]![cc] !== oi) return false;
    }
    return true;
  };
  const cx: GrowCtx = { own, cols, rows, rg, free };
  const wanted = (input.strategies ?? []).filter((s) => getStrategy(s));
  for (const oi of shuffle(offs.map((_, i) => i), rg)) {
    const o = offs[oi]!;
    o.strategy = rg.pick(wanted.length ? wanted : o.isLab ? POOL_LAB : POOL_OFFICE);
    getStrategy(o.strategy)!(o, oi, cx);
  }

  // ---- plaza & paths ----
  const comp = labelGrass(own, cols, rows);
  const doorCount = new Map<number, number>();
  for (const o of offs) {
    const cc = o.doorTile[1] >= 0 ? comp[K(o.doorTile[0], o.doorTile[1])]! : -1;
    if (cc >= 0) doorCount.set(cc, (doorCount.get(cc) ?? 0) + 1);
  }
  let mainComp = -1, best = 0;
  for (const [cc, k] of doorCount) if (k > best) { best = k; mainComp = cc; }
  const path = new Set<number>(), ptiles: number[] = [];
  const plazaC: Tile[] = [];
  for (let r = 1; r < rows - 3; r++) for (let c = 1; c < cols - 3; c++) {
    if (mainComp >= 0 && comp[K(c + 1, r + 1)] !== mainComp) continue;
    let ok = true;
    for (let dr = -1; dr <= 3 && ok; dr++) for (let dc = -1; dc <= 3 && ok; dc++) if (own[r + dr]![c + dc] !== -1) ok = false;
    if (ok) plazaC.push([c, r]);
  }
  const plazaOk = plazaC.length > 0;
  const plaza: Tile = plazaOk ? rg.pick(plazaC) : n ? [offs[0]!.doorTile[0], Math.max(0, offs[0]!.doorTile[1])] : [1, 1];
  if (plazaOk) {
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) { const k = K(plaza[0] + dc, plaza[1] + dr); if (!path.has(k)) { path.add(k); ptiles.push(k); } }
  } else { path.add(K(plaza[0], plaza[1])); ptiles.push(K(plaza[0], plaza[1])); }
  const noise = new Float64Array(rows * cols);
  for (let i = 0; i < noise.length; i++) noise[i] = rg.f() * 2.5;
  const route = makeRouter(own, cols, rows, noise, path);
  for (const oi of shuffle(offs.map((_, i) => i), rg)) {
    const dt = offs[oi]!.doorTile;
    if (dt[1] < 0) continue;
    for (const k of route(dt[0], dt[1])) if (!path.has(k)) { path.add(k); ptiles.push(k); }
  }

  // ---- trees, bushes, outdoor decor: keep a tile of grass around paths and buildings ----
  const near = (c: number, r: number, d: number): boolean => {
    for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      if (own[rr]![cc] !== -1 || path.has(K(cc, rr)) || reserved.has(K(cc, rr))) return true;
    }
    return false;
  };
  const scale = rows / 38;
  const trees: WorldLayout['trees'] = [], bushes: WorldLayout['bushes'] = [];
  for (let tries = 0, want = Math.round(rg.i(10, 18) * scale); trees.length < want && tries < 500 * scale; tries++) {
    const c = rg.i(0, cols - 2), r = rg.i(2, rows - 1);
    if (near(c, r, 1) || near(c + 1, r, 1) || near(c, r - 1, 0)) continue;
    if (trees.some((q) => Math.abs(q.c - c) < 3 && Math.abs(q.r - r) < 3)) continue;
    trees.push({ c, r, kind: rg.i(0, 2), x: c * TS - 3, y: GY + r * TS - 10 });
  }
  for (let tries = 0, want = Math.round(rg.i(10, 20) * scale); bushes.length < want && tries < 400 * scale; tries++) {
    const c = rg.i(0, cols - 1), r = rg.i(1, rows - 1);
    if (near(c, r, 0) || trees.some((q) => Math.abs(q.c - c) < 2 && Math.abs(q.r - r) < 2)) continue;
    bushes.push({ c, r, x: c * TS + rg.i(0, 2), y: GY + r * TS + rg.i(1, 3) });
  }
  const floorDecor = input.decor.filter((d) => d.place === 'floor');
  const wallDecor = input.decor.filter((d) => d.place === 'wall');
  const outdoor: PlacedDecor[] = [];
  if (floorDecor.length && plazaOk) {
    const d = rg.pick(floorDecor);
    outdoor.push({ id: d.id, x: plaza[0] * TS + 12 - (d.w >> 1), y: GY + plaza[1] * TS + 20 - d.h, w: d.w, h: d.h });
  }
  for (let tries = 0, k = floorDecor.length ? rg.i(1, 3) : 0; k > 0 && tries < 60; tries++) {
    const c = rg.i(1, cols - 3), r = rg.i(2, rows - 2);
    if (near(c, r, 1) || near(c + 1, r, 1) || trees.some((q) => Math.abs(q.c - c) < 3 && Math.abs(q.r - r) < 3)) continue;
    const d = rg.pick(floorDecor);
    outdoor.push({ id: d.id, x: c * TS, y: GY + r * TS + 8 - d.h, w: d.w, h: d.h }); k--;
  }

  // ---- finish offices: wall features, decor, build order (flood from the door) ----
  const reveal: RevealItem[] = [];
  const builders: BuilderPath[] = [];
  const timing: { start: number; dur: number; done: number; order: Tile[] }[] = offs.map(() => ({ start: 0, dur: 0, done: 0, order: [] }));
  const features: { windows: number[]; poster: number | null; wallDeco: PlacedDecor[]; decor: PlacedDecor[] }[] = offs.map(() => ({ windows: [], poster: null, wallDeco: [], decor: [] }));
  shuffle(offs.map((_, i) => i), rg).forEach((oi, k) => {
    const o = offs[oi]!, ft = features[oi]!;
    planWall(o, rg, wallDecor, ft);
    placeDecor(o, oi, own, rg, floorDecor, ft, cols, rows);
    const start: Tile = [o.doorTile[0], o.ty], seen = new Set<number>([K(start[0], start[1])]), q: Tile[] = [start], order: Tile[] = [];
    for (let h = 0; h < q.length; h++) {
      const t = q[h]!; order.push(t);
      for (const d of D4) {
        const c = t[0] + d[0], r = t[1] + d[1], kk = K(c, r);
        if (c < 0 || r < 0 || c >= cols || r >= rows || own[r]![c] !== oi || seen.has(kk)) continue;
        seen.add(kk); q.push([c, r]);
      }
    }
    const bs = 0.5 + k * 0.45, bd = 2 + order.length * 0.0045;
    timing[oi] = { start: bs, dur: bd, done: bs + bd + 0.25, order };
    order.forEach((tl, i) => reveal.push({ kind: 'office', x: tl[0] * TS, y: GY + tl[1] * TS, w: TS, h: TS, time: bs + (i / order.length) * bd }));
    for (let b = 0; b < 2; b++) {
      const keys: BuilderPath['keys'] = [];
      for (let i = b; i < order.length; i += 2) keys.push({ t: bs + (i / order.length) * bd, c: order[i]![0], r: order[i]![1] });
      builders.push({ office: o.id, index: b, keys });
    }
  });
  const pStart = (n ? Math.max(...timing.map((t) => t.done)) : 0) - 1.2;
  const pathTimes = ptiles.map((_, i) => pStart + i * 0.01);
  ptiles.forEach((k, i) => reveal.push({ kind: 'path', x: (k % cols) * TS, y: GY + Math.floor(k / cols) * TS, w: TS, h: TS, time: pathTimes[i]! }));
  const treeTimes = trees.map(() => pStart + rg.f() * 1.8);
  trees.forEach((tr, i) => reveal.push({ kind: 'tree', x: tr.x, y: tr.y, w: 14, h: 18, time: treeTimes[i]! }));
  const bushTimes = bushes.map(() => pStart + rg.f() * 1.8);
  bushes.forEach((b, i) => reveal.push({ kind: 'bush', x: b.x, y: b.y, w: 8, h: 6, time: bushTimes[i]! }));
  const buildEnd = (reveal.length ? Math.max(...reveal.map((r) => r.time)) : 0) + 0.4;

  // ---- output ----
  const offices: OfficeLayout[] = offs.map((o, oi) => {
    const t = timing[oi]!, ft = features[oi]!;
    const deskY = o.y + 58, podY = o.y + 46;
    const mk = (s: SlotDraft, i: number, y0: number): Slot => ({ index: i, dx: o.x + s.rel, dy: y0 + s.row * ROW_PITCH, agent: s.agent });
    const zones: ZoneLayout[] = o.zones.map((z) => ({ id: z.id, label: z.label, slots: z.slots.map((s, i) => mk(s, i, deskY)) }));
    return {
      id: o.id, kind: o.kind, label: o.label, floor: o.floor, wall: o.wall, strategy: o.strategy,
      tx: o.tx, ty: o.ty, tw: o.tw, th: o.th, x: o.x, y: o.y, w: o.w, h: o.h,
      deskY, deskRows: o.deskRows, rowPitch: ROW_PITCH, door: o.door, doorTile: o.doorTile, signEnd: o.signEnd, racks: o.racks,
      zones, capsules: o.capsules.map((s, i) => mk(s, i, podY)),
      windows: ft.windows, poster: ft.poster, wallDeco: ft.wallDeco, decor: ft.decor,
      order: t.order, buildStart: t.start, buildDur: t.dur, doneAt: t.done,
    };
  });
  const orderHints: WorldLayout['order'] = { offices: packOrder.map((i) => offs[i]!.id), agents: {} };
  for (const o of offices) {
    for (const z of o.zones) orderHints.agents[o.id + '/' + z.id] = z.slots.flatMap((s) => (s.agent ? [s.agent] : []));
    if (o.capsules.length) orderHints.agents[o.id + '/@pods'] = o.capsules.flatMap((s) => (s.agent ? [s.agent] : []));
  }
  return {
    seed: input.seed, season, cols, rows, own, offices, plaza, plazaOk, path: ptiles, trees, bushes, outdoor,
    build: { reveal, builders, pathTimes, treeTimes, bushTimes, buildEnd },
    order: orderHints,
  };
}

/** Connected components of grass tiles (-1 for non-grass). */
function labelGrass(own: number[][], cols: number, rows: number): Int32Array {
  const comp = new Int32Array(cols * rows).fill(-1);
  let id = 0;
  const stack: number[] = [];
  for (let s = 0; s < comp.length; s++) {
    if (comp[s] !== -1 || own[Math.floor(s / cols)]![s % cols] !== -1) continue;
    comp[s] = id; stack.push(s);
    while (stack.length) {
      const k = stack.pop()!, c = k % cols, r = (k / cols) | 0;
      for (const d of D4) {
        const cc = c + d[0], rr = r + d[1];
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const kk = rr * cols + cc;
        if (comp[kk] === -1 && own[rr]![cc] === -1) { comp[kk] = id; stack.push(kk); }
      }
    }
    id++;
  }
  return comp;
}

/** Cheapest noisy route from a tile to the existing path network (binary-heap Dijkstra). */
function makeRouter(own: number[][], cols: number, rows: number, noise: Float64Array, path: Set<number>) {
  const N = cols * rows;
  return (sc: number, sr: number): number[] => {
    const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const hd: number[] = [], hk: number[] = [];
    const push = (d: number, k: number): void => {
      hd.push(d); hk.push(k);
      let i = hd.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hd[p]! <= hd[i]!) break;
        [hd[p], hd[i]] = [hd[i]!, hd[p]!]; [hk[p], hk[i]] = [hk[i]!, hk[p]!]; i = p;
      }
    };
    const pop = (): [number, number] => {
      const top: [number, number] = [hd[0]!, hk[0]!];
      const ld = hd.pop()!, lk = hk.pop()!;
      if (hd.length) {
        hd[0] = ld; hk[0] = lk;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, rr = l + 1;
          let m = i;
          if (l < hd.length && hd[l]! < hd[m]!) m = l;
          if (rr < hd.length && hd[rr]! < hd[m]!) m = rr;
          if (m === i) break;
          [hd[m], hd[i]] = [hd[i]!, hd[m]!]; [hk[m], hk[i]] = [hk[i]!, hk[m]!]; i = m;
        }
      }
      return top;
    };
    const s = sr * cols + sc;
    dist[s] = 0; push(0, s);
    while (hd.length) {
      const [d0, k] = pop();
      if (done[k]) continue;
      done[k] = 1;
      if (path.has(k) && k !== s) {
        const out: number[] = [];
        let q = k;
        while (q !== -1) { out.push(q); q = prev[q]!; }
        return out.reverse();
      }
      const c = k % cols, r = (k / cols) | 0;
      for (const d of D4) {
        const cc = c + d[0], rr = r + d[1];
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows || own[rr]![cc] !== -1) continue;
        const kk = rr * cols + cc, nd = d0 + 1 + noise[kk]!;
        if (nd < dist[kk]!) { dist[kk] = nd; prev[kk] = k; push(nd, kk); }
      }
    }
    return [s];
  };
}

function planWall(o: Draft, rg: Rng, wallIds: DecorItem[], ft: { windows: number[]; poster: number | null; wallDeco: PlacedDecor[] }): void {
  let x = o.door + 16;
  const end = o.w - 30;
  while (x < end) {
    const opts: string[] = [];
    if (o.floor === 'parquet' && ft.windows.length < 2) opts.push('win');
    if ((o.floor === 'carpet' || o.floor === 'lab') && ft.poster == null) opts.push('poster');
    if (wallIds.length && ft.wallDeco.length < 3) opts.push('pop');
    if (!opts.length) break;
    const k = rg.pick(opts);
    if (k === 'win') { if (x + 22 > end) break; ft.windows.push(x); x += 22; }
    else if (k === 'poster') { if (x + 12 > end) break; ft.poster = x; x += 12; }
    else {
      const d = rg.pick(wallIds);
      if (x + d.w > end) break;
      ft.wallDeco.push({ id: d.id, x: o.x + x, y: o.y + 2 + Math.max(0, 12 - d.h), w: d.w, h: d.h });
      x += d.w;
    }
    x += rg.i(6, 18);
  }
}

function placeDecor(
  o: Draft, oi: number, own: number[][], rg: Rng, popF: DecorItem[],
  ft: { decor: PlacedDecor[] }, cols: number, rows: number,
): void {
  const basic = o.racks ? ['plant', 'lamp', 'shelf'] : o.isLab ? ['plant', 'lamp', 'cooler'] : ['plant', 'sofa', 'cooler', 'table', 'shelf', 'lamp'];
  const size = (id: string): [number, number] => DECO_SIZE[id] ?? (() => { const d = popF.find((p) => p.id === id); return d ? [d.w, d.h] as [number, number] : [8, 8] as [number, number]; })();
  const ownsPx = (x: number, y: number): boolean => {
    const c = Math.floor(x / TS), r = Math.floor((y - GY) / TS);
    return r >= 0 && c >= 0 && r < rows && c < cols && own[r]![c] === oi;
  };
  const fits = (x: number, y: number, w: number, h: number): boolean => {
    for (let yy = y; yy < y + h + 3; yy += 3) for (let xx = x; xx < x + w + 3; xx += 3) if (!ownsPx(Math.min(xx, x + w - 1), Math.min(yy, y + h - 1))) return false;
    return !ft.decor.some((d) => x < d.x + d.w + 3 && d.x < x + w + 3 && y < d.y + d.h + 2 && d.y < y + h + 2);
  };
  const pickId = (): string => (popF.length && rg.f() < 0.55 ? rg.pick(popF).id : rg.pick(basic));
  for (let n = rg.i(2, 4), tries = 0; n > 0 && tries < 50; tries++) {
    const id = pickId(), s = size(id), y = o.y + o.h - 2 - s[1], x = o.x + rg.i(8, Math.max(8, o.w - 36 - s[0]));
    if (y >= o.y + o.h - 23 && fits(x, y, s[0], s[1])) { ft.decor.push({ id, x, y, w: s[0], h: s[1] }); n--; }
  }
  const wing: Tile[] = [];
  const r0 = Math.max(0, o.ty - 1), r1 = Math.min(rows, o.ty + o.th + 20), c0 = Math.max(0, o.tx - 12), c1 = Math.min(cols, o.tx + o.tw + 12);
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (own[r]![c] === oi && (r >= o.ty + o.th || c < o.tx || c >= o.tx + o.tw)) wing.push([c, r]);
  for (let m = Math.min(5, Math.ceil(wing.length / 9)), tries = 0; m > 0 && wing.length && tries < 80; tries++) {
    const q = rg.pick(wing), id = pickId(), s = size(id), x = q[0] * TS + rg.i(0, 3), y = GY + q[1] * TS + 8 - s[1];
    if (fits(x, y, s[0], s[1])) { ft.decor.push({ id, x, y, w: s[0], h: s[1] }); m--; }
  }
}
