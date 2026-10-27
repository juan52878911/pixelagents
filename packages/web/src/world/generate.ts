/**
 * Incremental town generator. Every office is drafted from its content (zones, agents, pods) and
 * placed on the tile grid; given the previous layout, offices that still fit keep their tiles,
 * furniture and roads, offices that outgrow their hall are rebuilt in place (or relocated when
 * boxed in), and offices that disappear are demolished. Randomness is hashed per office / per tile
 * from the daily seed, never drawn sequentially, so adding or removing one office does not reshuffle
 * the others. See docs/world.md.
 */
import { FONT_4x6, FONT_5x7, fit, measure } from '../engine/fonts.js';
import { type OfficeGeom, planFurniture, walkableFn } from './furniture.js';
import { type Own, floodOrder, ownerAt, reach, resize, shapeUp, tilesOf } from './grid.js';
import { centralPlaza, makeRouter, plazaCandidates, tileNoise } from './paths.js';
import { makeRng, shuffle, strHash } from './rng.js';
import type { Rng } from './rng.js';
import { SEASONS, seasonFromSeed } from './seasons.js';
import { getStrategy, POOL_LAB, POOL_OFFICE } from './strategies.js';
import type { GrowCtx } from './strategies.js';
import { DEFAULT_COLS, GY, TS } from './types.js';
import type {
  Crew, DecorItem, FloorKind, GroupInput, OfficeLayout, PlacedDecor, RevealItem, Slot, Tile, WorldInput, WorldLayout, ZoneLayout,
} from './types.js';

export const SLOT_PITCH = 30;
export const ROW_PITCH = 40; // px between desk rows (5 tiles)
const BASE_TH = 13;
const MARGIN = 3; // columns kept free on each side of the map for offices
const EDGE = 2; // outermost columns where nothing grows, so side highways never close
const GROW_W = 2, GROW_H = 2; // free tiles kept right/below a new hall so it can grow in place
const SHRINK_W = 8; // tiles of spare width before an office is rebuilt smaller
const MAX_OFFICES = 12;
/** Free desks a zone may keep before its office is re-laid (1 is always kept for the next arrival). */
export const MAX_SPARE = 3;
const SIGN_MAX = 108; // px for the label of a sign
const DECO_SIZE: Record<string, [number, number]> = {
  plant: [8, 12], sofa: [34, 11], cooler: [7, 17], table: [16, 10], shelf: [12, 16], lamp: [7, 16],
};
const WALLS: Record<FloorKind, string> = { parquet: '#e8d9bf', carpet: '#b9c4d6', server: '#3a404c', lab: '#24323d' };

interface SlotDraft { rel: number; row: number; agent: string | null }
interface Draft {
  id: string; kind: string; label: string; isLab: boolean; floor: FloorKind; wall: string; racks: number;
  signLabel: string; signEnd: number; door: number; deskRows: number; strategy: string;
  zones: { id: string; label: string; slots: SlotDraft[] }[];
  capsules: SlotDraft[];
  startX: number; deskX1: number;
  needTw: number; needTh: number;
  // placement
  tx: number; ty: number; tw: number; th: number; x: number; y: number; w: number; h: number;
  doorTile: Tile; entry: Tile;
  prev: OfficeLayout | null; prevIdx: number;
  mode: 'keep' | 'renovate' | 'new';
  rg: Rng;
}

/** Text of a sign: the label (5×7) truncated to fit, and the kind (4×6). */
export function signParts(label: string, kind: string): { label: string; kind: string; width: number } {
  const l = fit(label, SIGN_MAX, FONT_5x7), k = kind.toUpperCase();
  return { label: l, kind: k, width: measure(l, FONT_5x7) + 4 + measure('· ' + k, FONT_4x6) };
}

function uniq(a: string[]): string[] { return [...new Set(a)]; }

/**
 * Agents of a zone in desk order. While the office stands (`prev`, not compacting) the previous
 * pattern is kept: departed agents leave holes, newcomers fill the first hole, and exactly one
 * free desk stays at the end. Rebuilt offices compact the row.
 */
function seatOrder(prevSlots: readonly { agent: string | null }[] | undefined, agents: string[], compact: boolean): (string | null)[] {
  const present = uniq(agents);
  if (!prevSlots || compact) return [...present, null];
  const out: (string | null)[] = prevSlots.map((s) => (s.agent && present.includes(s.agent) ? s.agent : null));
  const seated = new Set(out.filter((a): a is string => !!a));
  const known = new Set(prevSlots.flatMap((s) => (s.agent ? [s.agent] : [])));
  const incoming = [...present.filter((a) => known.has(a) && !seated.has(a)), ...present.filter((a) => !known.has(a))];
  for (const a of incoming) {
    const hole = out.indexOf(null);
    if (hole >= 0) out[hole] = a; else out.push(a);
  }
  const spare = out.filter((a) => a === null).length;
  if (spare === 0) out.push(null);
  else if (spare > MAX_SPARE) { while (out.length && out[out.length - 1] === null) out.pop(); out.push(null); }
  return out;
}

/** One office: its content decides the size of its main hall. Own rng per office (seed + id). */
function makeDraft(g: GroupInput, cols: number, seed: string, prev: OfficeLayout | null, prevIdx: number, compact: boolean): Draft {
  const rg = makeRng(strHash(seed + '|' + g.id));
  const isLab = g.kind === 'lab' || g.pods !== undefined;
  const floor: FloorKind = g.kind === 'server' ? 'server' : isLab ? 'lab' : rg.f() < 0.5 ? 'parquet' : 'carpet';
  const racks = g.kind === 'server' ? 2 : 0;
  const sign = signParts(g.label, g.kind);
  const signEnd = 5 + sign.width + 6;
  const door = signEnd + 6 + rg.i(0, 12);
  const o: Draft = {
    id: g.id, kind: g.kind, label: g.label, isLab, floor, wall: WALLS[floor], racks, signLabel: sign.label, signEnd, door, deskRows: 1,
    strategy: '', zones: [], capsules: [], startX: 12 + (racks ? racks * 16 + 4 : 0), deskX1: 0, needTw: 0, needTh: BASE_TH,
    tx: 0, ty: 0, tw: 0, th: BASE_TH, x: 0, y: 0, w: 0, h: 0, doorTile: [0, 0], entry: [0, 0], prev, prevIdx, mode: 'new', rg,
  };
  const maxCur = (cols - 2 * MARGIN) * TS - 30;
  const startX = o.startX;
  let cur = startX, row = 0, maxUsed = startX;
  const place = (n: number): SlotDraft[] => {
    const need = (n - 1) * SLOT_PITCH + 34 + 6;
    if (cur + need > maxCur && cur > startX) { row++; cur = startX; }
    const slots: SlotDraft[] = [];
    for (let k = 0; k < n; k++) {
      if (cur + 5 + k * SLOT_PITCH + 34 > maxCur && k > 0) { row++; cur = startX - k * SLOT_PITCH; }
      slots.push({ rel: cur + 5 + k * SLOT_PITCH, row, agent: null });
      maxUsed = Math.max(maxUsed, cur + k * SLOT_PITCH + 34 + 6);
    }
    const last = slots[n - 1]!;
    cur = last.rel - 5 + 34 + 6;
    maxUsed = Math.max(maxUsed, cur);
    return slots;
  };
  // zones keep yesterday's order while the office stands; new zones go after the known ones
  const order = shuffle(g.zones.map((_, i) => i), rg);
  if (prev) {
    const rank = (i: number): number => { const p = prev.zones.findIndex((z) => z.id === g.zones[i]!.id); return p < 0 ? 1e6 + i : p; };
    order.sort((a, b) => rank(a) - rank(b));
  }
  for (const zi of order) {
    const z = g.zones[zi]!;
    const seats = seatOrder(prev?.zones.find((x) => x.id === z.id)?.slots, z.agents, compact);
    const slots = place(seats.length);
    seats.forEach((a, k) => { slots[k]!.agent = a; });
    o.zones.push({ id: z.id, label: z.label, slots });
  }
  if (g.pods !== undefined) {
    const seats = seatOrder(prev?.capsules, g.pods, compact);
    const slots = place(seats.length);
    seats.forEach((a, k) => { slots[k]!.agent = a; });
    o.capsules = slots;
  }
  o.deskRows = row + 1;
  o.deskX1 = maxUsed;
  o.needTh = BASE_TH + (o.deskRows - 1) * (ROW_PITCH / TS);
  o.needTw = Math.min(cols - 2 * MARGIN, Math.max(Math.ceil((maxUsed + 30) / TS), Math.ceil((door + 16) / TS), 12));
  return o;
}

function geomOf(o: Draft, oi: number): OfficeGeom {
  return {
    oi, tx: o.tx, ty: o.ty, tw: o.tw, th: o.th, deskRows: o.deskRows, rowPitch: ROW_PITCH / TS,
    deskX0: o.startX, deskX1: o.deskX1,
    racks: o.racks ? { c0: 0, c1: Math.floor((6 + o.racks * 16 - 5) / TS), r0: 2, r1: 5 } : null,
    entry: o.entry,
  };
}

function setHall(o: Draft, tx: number, ty: number, tw: number, th: number): void {
  o.tx = tx; o.ty = ty; o.tw = tw; o.th = th;
  o.x = tx * TS; o.y = GY + ty * TS; o.w = tw * TS; o.h = th * TS;
  o.door = Math.min(o.door, o.w - 14);
  const dc = tx + Math.floor((o.door + 5) / TS);
  o.doorTile = [dc, ty - 1];
  o.entry = [dc, ty + 2];
}

export function generateWorld(input: WorldInput, prev?: WorldLayout | null): WorldLayout {
  const cols = Math.max(24, input.cols ?? DEFAULT_COLS);
  const seedN = strHash(input.seed);
  const season = input.season && SEASONS[input.season] ? input.season : seasonFromSeed(input.seed);
  const P = prev && prev.seed === input.seed && prev.cols === cols ? prev : null;
  const groups = input.groups.filter((g, i, a) => a.findIndex((x) => x.id === g.id) === i).slice(0, MAX_OFFICES);
  // previous order first (stability), then newcomers in input order
  const prevIds = P ? P.offices.map((o) => o.id) : [];
  groups.sort((a, b) => { const ia = prevIds.indexOf(a.id), ib = prevIds.indexOf(b.id); return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib); });
  const offs: Draft[] = groups.map((g) => {
    const pi = P ? P.offices.findIndex((o) => o.id === g.id && o.kind === g.kind && o.label === g.label) : -1;
    return makeDraft(g, cols, input.seed, pi >= 0 ? P!.offices[pi]! : null, pi, pi < 0);
  });

  // ---- ownership grid: keep what fits, rebuild what grew, place the rest ----
  const own: Own = [];
  let rows = Math.max(38, P ? P.rows : 0);
  resize(own, cols, rows);
  const reserved = new Set<number>();
  const K = (c: number, r: number): number => r * cols + c;
  const grass = (c: number, r: number): boolean => c >= EDGE && c < cols - EDGE && r >= 0 && ownerAt(own, c, r) === -1 && !reserved.has(K(c, r));
  const ensureRows = (n: number): void => { if (n > rows) { rows = n; resize(own, cols, rows); } };
  /** hall rect + door tiles + growth margin, all grass (tiles already owned by `self` are fine) */
  const hallFree = (tx: number, ty: number, tw: number, th: number, self: number, margin: boolean): boolean => {
    if (tx - 1 < EDGE || tx + tw + 1 > cols - EDGE || ty < 2) return false;
    ensureRows(ty + th + GROW_H + 2);
    const x1 = tx + tw + 1 + (margin ? GROW_W : 0), y1 = ty + th + 1 + (margin ? GROW_H : 0);
    for (let r = ty - 2; r < y1; r++) for (let c = tx - 1; c < x1; c++) {
      if (c < 0 || c >= cols) return false;
      const o = ownerAt(own, c, r);
      if (o === self) continue;
      if (o !== -1 || reserved.has(K(c, r))) return false;
    }
    return true;
  };
  const claimHall = (o: Draft, oi: number): void => {
    for (let r = o.ty; r < o.ty + o.th; r++) for (let c = o.tx; c < o.tx + o.tw; c++) own[r]![c] = oi;
    reserved.add(K(o.doorTile[0], o.ty - 1)); reserved.add(K(o.doorTile[0], o.ty - 2));
  };
  // 1. offices that keep their geometry (copy every tile, wings included)
  offs.forEach((o, oi) => {
    const p = o.prev;
    if (!p) return;
    const fits = o.needTw <= p.tw && o.needTh <= p.th;
    const shrink = o.needTw <= p.tw - SHRINK_W || o.needTh < p.th;
    if (!fits || shrink) return;
    o.mode = 'keep';
    o.strategy = p.strategy;
    setHall(o, p.tx, p.ty, p.tw, p.th);
    o.door = p.door; o.doorTile = p.doorTile; o.entry = p.entry;
    for (const [c, r] of p.tiles) { ensureRows(r + 1); own[r]![c] = oi; }
    reserved.add(K(o.doorTile[0], o.ty - 1)); reserved.add(K(o.doorTile[0], o.ty - 2));
  });
  // 2. offices rebuilt in place when their old spot still has room (desks compacted)
  offs.forEach((o, oi) => {
    const p = o.prev;
    if (!p || o.mode === 'keep') return;
    offs[oi] = makeDraft(groups[oi]!, cols, input.seed, p, o.prevIdx, true);
    o = offs[oi]!;
    // reclaim the old tiles first so the new hall may reuse them
    for (const [c, r] of p.tiles) if (ownerAt(own, c, r) === -1) own[r]![c] = oi;
    setHall(o, p.tx, p.ty, o.needTw, o.needTh);
    if (hallFree(o.tx, o.ty, o.tw, o.th, oi, false)) {
      o.mode = 'renovate';
      for (const [c, r] of p.tiles) own[r]![c] = -1;
      claimHall(o, oi);
    } else {
      for (const [c, r] of p.tiles) if (ownerAt(own, c, r) === oi) own[r]![c] = -1;
      o.prev = null; o.prevIdx = -1; o.mode = 'new';
    }
  });
  // 3. newcomers and relocated offices: first spot that fits, scanning from the top
  offs.forEach((o, oi) => {
    if (o.mode !== 'new') return;
    const ltr = o.rg.f() < 0.5, jitter = o.rg.i(0, 2);
    let placed = false;
    for (let ty = 2 + jitter; !placed; ty++) {
      ensureRows(ty + o.needTh + GROW_H + 3);
      for (let i = 0; i <= cols - 2 * MARGIN - o.needTw && !placed; i++) {
        const tx = ltr ? MARGIN + i : cols - MARGIN - o.needTw - i;
        if (hallFree(tx, ty, o.needTw, o.needTh, -2, true)) { setHall(o, tx, ty, o.needTw, o.needTh); claimHall(o, oi); placed = true; }
      }
      if (ty > 4000) throw new Error('world: no room for an office');
    }
  });

  // ---- wings: grow the rebuilt offices with their strategy, then make the shapes valid ----
  let maxBottom = 0;
  for (const o of offs) maxBottom = Math.max(maxBottom, o.ty + o.th);
  ensureRows(Math.max(38, maxBottom + 12));
  const free = (c: number, r: number, oi: number): boolean => {
    if (!grass(c, r) || r >= rows) return false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const v = ownerAt(own, c + dc, r + dr);
      if (v !== -1 && v !== oi) return false;
    }
    return true;
  };
  const wanted = (input.strategies ?? []).filter((s) => getStrategy(s));
  offs.forEach((o, oi) => {
    if (o.mode === 'keep') return;
    o.strategy = o.rg.pick(wanted.length ? wanted : o.isLab ? POOL_LAB : POOL_OFFICE);
    const cx: GrowCtx = { own, cols, rows, rg: o.rg, free };
    getStrategy(o.strategy)!(o, oi, cx);
    // valid shape: 2×2 blocks, connected to the hall, every room reachable from the entry
    for (let pass = 0; pass < 6; pass++) {
      shapeUp(own, oi, o);
      const g = geomOf(o, oi), walk = walkableFn(own, g, []);
      const seen = reach(own, oi, o.entry, walk);
      let cut = 0;
      for (const [c, r] of tilesOf(own, oi)) {
        const hall = c >= o.tx && c < o.tx + o.tw && r >= o.ty && r < o.ty + o.th;
        if (!hall && walk(c, r) && !seen.has(K(c, r))) { own[r]![c] = -1; cut++; }
      }
      if (!cut) break;
    }
  });
  {
    let mr = 0;
    for (let r = 0; r < rows; r++) if (own[r]!.some((v) => v !== -1)) mr = r;
    rows = Math.max(38, mr + 8);
    resize(own, cols, rows);
  }
  const tilesByOffice = offs.map((_, oi) => tilesOf(own, oi));

  // ---- plaza and roads ----
  const doors = offs.map((o) => o.doorTile);
  const cands = plazaCandidates(own, cols, rows, doors);
  const candKeys = new Set(cands.map((t) => K(t[0], t[1])));
  const plazaOk = cands.length > 0;
  let plaza: Tile;
  if (plazaOk) plaza = P && P.plazaOk && candKeys.has(K(P.plaza[0], P.plaza[1])) ? P.plaza : centralPlaza(cands, doors)!;
  else plaza = offs.length ? [offs[0]!.doorTile[0], Math.max(0, offs[0]!.doorTile[1])] : [1, 1];
  const path = new Set<number>(), ptiles: number[] = [];
  const addPath = (k: number): void => { if (!path.has(k)) { path.add(k); ptiles.push(k); } };
  if (plazaOk) for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) addPath(K(plaza[0] + dc, plaza[1] + dr));
  else addPath(K(plaza[0], plaza[1]));
  const prevPath = new Set<number>(P && P.rows === rows ? P.path : []);
  if (P && P.rows !== rows) for (const k of P.path) { const c = k % P.cols, r = Math.floor(k / P.cols); if (r < rows) prevPath.add(K(c, r)); }
  const route = makeRouter(own, cols, rows, (k) => (prevPath.has(k) ? 0.25 : 1 + tileNoise(seedN, k)), path);
  for (const o of offs) {
    const dt = o.doorTile;
    if (dt[1] < 0) continue;
    for (const k of route(dt[0], dt[1])) addPath(k);
  }

  // ---- trees, bushes, outdoor decor: per-tile hashes, a tile of grass around roads and walls ----
  const near = (c: number, r: number, d: number): boolean => {
    for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      if (own[rr]![cc] !== -1 || path.has(K(cc, rr)) || reserved.has(K(cc, rr))) return true;
    }
    return false;
  };
  const th = (salt: number, c: number, r: number): number => Math.floor(tileNoise(seedN ^ Math.imul(salt, 0x85ebca6b), K(c, r)) * 400);
  const trees: WorldLayout['trees'] = [], bushes: WorldLayout['bushes'] = [];
  for (let r = 2; r < rows - 1; r++) for (let c = 0; c < cols - 2; c++) {
    const h = th(1, c, r);
    if (h % 24 !== 0) continue;
    if (near(c, r, 1) || near(c + 1, r, 1) || near(c, r - 1, 0)) continue;
    if (trees.some((q) => Math.abs(q.c - c) < 3 && Math.abs(q.r - r) < 3)) continue;
    trees.push({ c, r, kind: Math.floor(h / 24) % 3, x: c * TS - 3, y: GY + r * TS - 10 });
  }
  for (let r = 1; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const h = th(2, c, r);
    if (h % 22 !== 0) continue;
    if (near(c, r, 0) || trees.some((q) => Math.abs(q.c - c) < 2 && Math.abs(q.r - r) < 2)) continue;
    bushes.push({ c, r, x: c * TS + Math.floor(h / 22) % 3, y: GY + r * TS + 1 + Math.floor(h / 66) % 3 });
  }
  const floorDecor = input.decor.filter((d) => d.place === 'floor');
  const wallDecor = input.decor.filter((d) => d.place === 'wall');
  const outdoor: PlacedDecor[] = [];
  if (floorDecor.length && plazaOk) {
    const d = floorDecor[th(3, plaza[0], plaza[1]) % floorDecor.length]!;
    outdoor.push({ id: d.id, x: plaza[0] * TS + 12 - (d.w >> 1), y: GY + plaza[1] * TS + 20 - d.h, w: d.w, h: d.h });
  }
  if (floorDecor.length) for (let r = 2; r < rows - 2 && outdoor.length < 4; r++) for (let c = 1; c < cols - 3 && outdoor.length < 4; c++) {
    const h = th(4, c, r);
    if (h % 150 !== 0 || near(c, r, 1) || near(c + 1, r, 1) || trees.some((q) => Math.abs(q.c - c) < 3 && Math.abs(q.r - r) < 3)) continue;
    const d = floorDecor[Math.floor(h / 150) % floorDecor.length]!;
    outdoor.push({ id: d.id, x: c * TS, y: GY + r * TS + 8 - d.h, w: d.w, h: d.h });
  }

  // ---- finish offices: wall features, furniture (kept offices keep theirs) ----
  const features = offs.map((o, oi): { windows: number[]; poster: number | null; wallDeco: PlacedDecor[]; decor: PlacedDecor[] } => {
    if (o.mode === 'keep' && o.prev) return { windows: o.prev.windows, poster: o.prev.poster, wallDeco: o.prev.wallDeco, decor: o.prev.decor };
    const ft = { windows: [] as number[], poster: null as number | null, wallDeco: [] as PlacedDecor[], decor: [] as PlacedDecor[] };
    planWall(o, o.rg, wallDecor, ft);
    const basic = o.racks ? ['plant', 'lamp', 'shelf'] : o.isLab ? ['plant', 'lamp', 'cooler'] : ['plant', 'sofa', 'cooler', 'table', 'shelf', 'lamp'];
    const size = (id: string): [number, number] => DECO_SIZE[id] ?? ((): [number, number] => { const d = floorDecor.find((p) => p.id === id); return d ? [d.w, d.h] : [8, 8]; })();
    const pick = () => { const id = floorDecor.length && o.rg.f() < 0.55 ? o.rg.pick(floorDecor).id : o.rg.pick(basic); const s = size(id); return { id, w: s[0], h: s[1] }; };
    ft.decor = planFurniture(own, geomOf(o, oi), o.rg, pick, o.rg.i(2, 4));
    return ft;
  });

  // ---- timeline: demolish what stood before, then build what changed, then roads and nature ----
  const reveal: RevealItem[] = [], demolish: RevealItem[] = [], crews: Crew[] = [];
  let t = 0;
  if (P) {
    const gone = P.offices.filter((po) => { const o = offs.find((x) => x.id === po.id); return !o || o.mode !== 'keep'; });
    gone.forEach((po, k) => {
      const start = 0.1 + k * 0.2, dur = 0.4 + po.tiles.length * 0.003;
      const order = orderFrom(po.tiles, po.entry);
      order.forEach((tl, i) => demolish.push({ kind: 'office', x: tl[0] * TS, y: GY + tl[1] * TS, w: TS, h: TS, time: start + (i / Math.max(1, order.length)) * dur }));
      crews.push({ id: po.id, kind: 'demolish', order, start, dur });
      t = Math.max(t, start + dur + 0.3);
    });
    for (const k of P.path) { const c = k % P.cols, r = Math.floor(k / P.cols); if (!path.has(K(c, r)) || r >= rows) demolish.push({ kind: 'path', x: c * TS, y: GY + r * TS, w: TS, h: TS, time: 0 }); }
    for (const tr of P.trees) if (!trees.some((q) => q.c === tr.c && q.r === tr.r)) demolish.push({ kind: 'tree', x: tr.x, y: tr.y, w: 14, h: 18, time: 0 });
    for (const b of P.bushes) if (!bushes.some((q) => q.c === b.c && q.r === b.r)) demolish.push({ kind: 'bush', x: b.x, y: b.y, w: 8, h: 6, time: 0 });
    for (const d of P.outdoor) if (!outdoor.some((q) => q.x === d.x && q.y === d.y && q.id === d.id)) demolish.push({ kind: 'outdoor', x: d.x, y: d.y, w: d.w, h: d.h, time: 0 });
  }
  const timing = offs.map(() => ({ start: -1, dur: 0, done: -1 }));
  const orders = offs.map((o, oi) => floodOrder(own, oi, [o.doorTile[0], o.ty]));
  let k = 0;
  offs.forEach((o, oi) => {
    if (o.mode === 'keep') return;
    const order = orders[oi]!;
    const bs = t + 0.5 + k * 0.45, bd = 2 + order.length * 0.0045;
    timing[oi] = { start: bs, dur: bd, done: bs + bd + 0.25 };
    order.forEach((tl, i) => reveal.push({ kind: 'office', x: tl[0] * TS, y: GY + tl[1] * TS, w: TS, h: TS, time: bs + (i / order.length) * bd }));
    crews.push({ id: o.id, kind: 'build', order, start: bs, dur: bd });
    k++;
  });
  const built = timing.filter((x) => x.done >= 0).map((x) => x.done);
  const pStart = built.length ? Math.max(...built) - 1.2 : t;
  const newPath = ptiles.filter((kk) => !prevPath.has(kk) || !P);
  const pathTimes = ptiles.map((kk, i) => (P && prevPath.has(kk) ? -1 : pStart + (newPath.indexOf(kk) >= 0 ? newPath.indexOf(kk) : i) * 0.01));
  ptiles.forEach((kk, i) => { if (pathTimes[i]! >= 0) reveal.push({ kind: 'path', x: (kk % cols) * TS, y: GY + Math.floor(kk / cols) * TS, w: TS, h: TS, time: pathTimes[i]! }); });
  const treeTimes = trees.map((tr) => (P && P.trees.some((q) => q.c === tr.c && q.r === tr.r) ? -1 : pStart + (th(5, tr.c, tr.r) % 100) / 100 * 1.8));
  trees.forEach((tr, i) => { if (treeTimes[i]! >= 0) reveal.push({ kind: 'tree', x: tr.x, y: tr.y, w: 14, h: 18, time: treeTimes[i]! }); });
  const bushTimes = bushes.map((b) => (P && P.bushes.some((q) => q.c === b.c && q.r === b.r) ? -1 : pStart + (th(6, b.c, b.r) % 100) / 100 * 1.8));
  bushes.forEach((b, i) => { if (bushTimes[i]! >= 0) reveal.push({ kind: 'bush', x: b.x, y: b.y, w: 8, h: 6, time: bushTimes[i]! }); });
  outdoor.forEach((d) => { if (!P || !P.outdoor.some((q) => q.x === d.x && q.y === d.y && q.id === d.id)) reveal.push({ kind: 'outdoor', x: d.x, y: d.y, w: d.w, h: d.h, time: pStart + 0.5 }); });
  const all = [...reveal, ...demolish].map((r) => r.time);
  const buildEnd = all.length ? Math.max(...all, 0) + 0.4 : 0;
  const changedGeo = reveal.length > 0 || demolish.length > 0 || !P;
  const epoch = prev ? (changedGeo ? prev.epoch + 1 : prev.epoch) : 0;
  // same epoch: the previous timeline (and its reveal list) goes on as it was
  if (P && !changedGeo) {
    offs.forEach((o, oi) => { const p = o.prev!; timing[oi] = { start: p.buildStart, dur: p.buildDur, done: p.doneAt }; orders[oi] = p.order; });
  }
  const changedFlag = (o: Draft): boolean => (P && !changedGeo ? !!o.prev?.changed : o.mode !== 'keep');
  const build = P && !changedGeo ? P.build : { reveal, demolish, crews, builders: [] as WorldLayout['build']['builders'], pathTimes, treeTimes, bushTimes, buildEnd };

  // ---- output ----
  const offices: OfficeLayout[] = offs.map((o, oi) => {
    const tm = timing[oi]!, ft = features[oi]!;
    const deskY = o.y + 58, podY = o.y + 46;
    const mk = (s: SlotDraft, i: number, y0: number): Slot => ({ index: i, dx: o.x + s.rel, dy: y0 + s.row * ROW_PITCH, agent: s.agent });
    const zones: ZoneLayout[] = o.zones.map((z) => ({ id: z.id, label: z.label, slots: z.slots.map((s, i) => mk(s, i, deskY)) }));
    return {
      id: o.id, kind: o.kind, label: o.label, floor: o.floor, wall: o.wall, strategy: o.strategy,
      tx: o.tx, ty: o.ty, tw: o.tw, th: o.th, x: o.x, y: o.y, w: o.w, h: o.h,
      deskY, deskRows: o.deskRows, rowPitch: ROW_PITCH, door: o.door, doorTile: o.doorTile, signEnd: o.signEnd, racks: o.racks,
      zones, capsules: o.capsules.map((s, i) => mk(s, i, podY)),
      windows: ft.windows, poster: ft.poster, wallDeco: ft.wallDeco, decor: ft.decor,
      tiles: tilesByOffice[oi]!, entry: o.entry, startX: o.startX, changed: changedFlag(o),
      order: orders[oi]!, buildStart: tm.start, buildDur: tm.dur, doneAt: tm.done,
    };
  });
  const orderHints: WorldLayout['order'] = { offices: offices.map((o) => o.id), agents: {} };
  for (const o of offices) {
    for (const z of o.zones) orderHints.agents[o.id + '/' + z.id] = z.slots.flatMap((s) => (s.agent ? [s.agent] : []));
    if (o.capsules.length) orderHints.agents[o.id + '/@pods'] = o.capsules.flatMap((s) => (s.agent ? [s.agent] : []));
  }
  if (build.builders.length === 0) build.builders = crews.filter((c) => c.kind === 'build').flatMap((c) => [0, 1].map((b) => ({
    office: c.id, index: b, keys: c.order.filter((_, i) => i % 2 === b).map((tl, i) => ({ t: c.start + ((i * 2 + b) / c.order.length) * c.dur, c: tl[0], r: tl[1] })),
  })));
  return {
    seed: input.seed, season, cols, rows, own, offices, plaza, plazaOk, path: ptiles, trees, bushes, outdoor,
    build, epoch, order: orderHints,
  };
}

/** BFS order over a tile list from `start` (for demolition of a previous office). */
function orderFrom(tiles: Tile[], start: Tile): Tile[] {
  const set = new Map<string, Tile>();
  for (const t of tiles) set.set(t[0] + ',' + t[1], t);
  const k0 = start[0] + ',' + start[1];
  const first = set.get(k0) ?? tiles[0];
  if (!first) return [];
  const seen = new Set<string>([first[0] + ',' + first[1]]), q: Tile[] = [first], out: Tile[] = [];
  for (let h = 0; h < q.length; h++) {
    const t = q[h]!; out.push(t);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const kk = (t[0] + dc) + ',' + (t[1] + dr), n = set.get(kk);
      if (n && !seen.has(kk)) { seen.add(kk); q.push(n); }
    }
  }
  for (const t of tiles) if (!seen.has(t[0] + ',' + t[1])) out.push(t);
  return out;
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
