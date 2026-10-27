/**
 * Incremental generator of the shared floor. One building: a lobby (reception with the entrance)
 * seeds a corridor network; every office is a territory hanging off a corridor through its door,
 * sharing walls with its neighbours. Halls are sized by content (zones, agents, pods); territories
 * grow from the hall by competitive accretion until their area matches their demand; corridors are
 * carved first (Prim-style tree of cheapest routes), so offices fill the cells between them;
 * enclosed leftovers become break pockets. Given the previous layout, offices that still fit keep
 * their tiles, offices that grew claim from their frontier (free space, pockets, neighbours' wings,
 * then outward), offices that shrank release tiles, departed offices are demolished. Randomness is
 * hashed per office / per tile from the daily seed, never drawn sequentially, so adding or removing
 * one office does not reshuffle the others. See docs/world.md.
 */
import { FONT_4x6, FONT_5x7, fit, measure } from '../engine/fonts.js';
import { type OfficeGeom, placementProblem, planFurniture, walkableFn } from './furniture.js';
import { type Own, D4, floodOrder, labelGrass, ownerAt, reach, resize, shapeUp, tilesOf } from './grid.js';
import { makeRouter, tileNoise } from './paths.js';
import { makeRng, shuffle, strHash } from './rng.js';
import type { Rng } from './rng.js';
import { SEASONS, seasonFromSeed } from './seasons.js';
import { getStrategy, POOL_LAB, POOL_OFFICE } from './strategies.js';
import type { GrowCtx } from './strategies.js';
import { accrete, smooth, type Territory } from './territory.js';
import { COMMON, DEFAULT_COLS, GY, TS } from './types.js';
import type {
  Crew, DecorItem, FloorKind, GroupInput, Lobby, OfficeLayout, PlacedDecor, RevealItem, Slot, Tile, WorldInput, WorldLayout, ZoneLayout,
} from './types.js';

export const SLOT_PITCH = 30;
export const ROW_PITCH = 40; // px between desk rows (5 tiles)
const BASE_TH = 13;
const MARGIN = 3; // columns kept free on each side of the map for offices
const EDGE = 2; // outermost columns where nothing grows
const GROW_W = 2, GROW_H = 2; // free tiles kept right/below a new hall so it can grow in place
const SHRINK_W = 8; // tiles of spare width before an office is rebuilt smaller
const MAX_OFFICES = 12;
/** Free desks a zone may keep before its office is re-laid (1 is always kept for the next arrival). */
export const MAX_SPARE = 3;
const SIGN_MAX = 108; // px for the label of a sign
export const LOBBY_TY = 6, LOBBY_W = 8, LOBBY_H = 4; // rows ty..ty+1 wall with the entrance, ty+2..ty+3 floor
/** first row of the floor: corridors and offices live from here down; above is outdoors */
export const INSIDE_R0 = LOBBY_TY + 2;
const OFFICE_TY0 = LOBBY_TY + 4; // first row a hall may start on (its door strip sits on the lobby floor rows)
const STRIP = 2; // corridor rows above every hall (door strip)
const WING_REACH = 4; // max Chebyshev distance a wing may reach from its hall
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
  /** wings may still grow (new / grown offices) */
  grow: boolean;
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
    tx: 0, ty: 0, tw: 0, th: BASE_TH, x: 0, y: 0, w: 0, h: 0, doorTile: [0, 0], entry: [0, 0], prev, prevIdx, mode: 'new', grow: true, rg,
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

/** The lobby: centred, `LOBBY_W` wide, wall rows ty..ty+1 (entrance door in the middle) and floor rows ty+2..ty+3. */
export function makeLobby(cols: number): Lobby {
  const tx = Math.floor((cols - LOBBY_W) / 2), ty = LOBBY_TY;
  const dc = tx + (LOBBY_W >> 1) - 1;
  return { tx, ty, tw: LOBBY_W, th: LOBBY_H, x: tx * TS, y: GY + ty * TS, w: LOBBY_W * TS, h: LOBBY_H * TS, door: (dc - tx) * TS - 2, doorTile: [dc, ty - 1], entry: [dc, ty + 2] };
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

  // ---- grid: lobby, previous corridors, then offices (keep / claim in place / place anew) ----
  const own: Own = [];
  let rows = Math.max(38, P ? P.rows : 0);
  resize(own, cols, rows);
  const K = (c: number, r: number): number => r * cols + c;
  const ensureRows = (n: number): void => { if (n > rows) { rows = n; resize(own, cols, rows); } };
  const lobby = makeLobby(cols);
  /** shared tiles nothing may claim: lobby, door strips, routes (this layout) and the previous corridors (until re-routed) */
  const structural = new Set<number>();
  for (let r = lobby.ty; r < lobby.ty + lobby.th; r++) for (let c = lobby.tx; c < lobby.tx + lobby.tw; c++) { own[r]![c] = COMMON; structural.add(K(c, r)); }
  const prevCorr = new Set<number>();
  if (P) for (const k of P.corridor) { const c = k % cols, r = Math.floor(k / cols); if (r < rows && own[r]![c] === -1) { own[r]![c] = COMMON; structural.add(k); prevCorr.add(k); } }
  /** where wings may grow: never the side channels (cols 1..MARGIN-1 and the mirror) corridors run along */
  const inside = (c: number, r: number): boolean => c >= MARGIN && c < cols - MARGIN && r >= INSIDE_R0 && r < rows;
  /** where corridors may run: the floor plus the side channels */
  const routable = (c: number, r: number): boolean => c >= 1 && c < cols - 1 && r >= INSIDE_R0 && r < rows;
  /** a wing tile of a standing office: a corridor may cut through it (the office is pushed) */
  const isWing = (c: number, r: number): boolean => { const v = ownerAt(own, c, r); return v >= 0 && !inHallOf(v, c, r); };
  /** grass or a break pocket (shared but not structural) */
  const spare = (c: number, r: number): boolean => { const v = ownerAt(own, c, r); return v === -1 || (v === COMMON && !structural.has(K(c, r))); };
  const inHallOf = (oi: number, c: number, r: number): boolean => { const o = offs[oi]!; return c >= o.tx && c < o.tx + o.tw && r >= o.ty && r < o.ty + o.th; };
  const pushed = new Set<number>();
  /**
   * May a hall stand at (tx, ty, tw, th)? Rect tiles: own, spare, or (pushable) a wing of a standing
   * office; the door strip above: anything but another office; the growth margin: no other office.
   */
  /** column of the hard obstacle (an office or corridor tile inside the rect) the last `hallFree` hit, or -1 */
  let blockC = -1;
  const hallFree = (tx: number, ty: number, tw: number, th: number, self: number, margin: boolean, pushable: boolean): boolean => {
    blockC = -1;
    if (tx < MARGIN || tx + tw > cols - MARGIN || ty < OFFICE_TY0) return false;
    ensureRows(ty + th + GROW_H + 2);
    for (let r = ty - STRIP; r < ty + th + (margin ? GROW_H : 0); r++) for (let c = tx; c < tx + tw + (margin ? GROW_W : 0); c++) {
      if (c >= cols) return false;
      const v = ownerAt(own, c, r);
      if (v === self) continue;
      const core = r >= ty && r < ty + th && c < tx + tw;
      if (!core) { if (v >= 0) return false; continue; }
      if (spare(c, r)) continue;
      if (pushable && v >= 0 && v !== self && offs[v]!.mode === 'keep' && !inHallOf(v, c, r)) continue;
      blockC = c;
      return false;
    }
    return true;
  };
  const claimHall = (o: Draft, oi: number): void => {
    for (let r = o.ty; r < o.ty + o.th; r++) for (let c = o.tx; c < o.tx + o.tw; c++) {
      const v = own[r]![c]!;
      if (v >= 0 && v !== oi) pushed.add(v);
      own[r]![c] = oi;
    }
    for (let r = o.ty - STRIP; r < o.ty; r++) for (let c = o.tx; c < o.tx + o.tw; c++) { own[r]![c] = COMMON; structural.add(K(c, r)); }
  };
  const dropTiles = (oi: number, keep?: (c: number, r: number) => boolean): void => {
    for (const [c, r] of tilesOf(own, oi)) if (!keep || !keep(c, r)) own[r]![c] = -1;
  };
  // 1. offices that keep their geometry (copy every tile, wings included)
  offs.forEach((o, oi) => {
    const p = o.prev;
    if (!p) return;
    const fits = o.needTw <= p.tw && o.needTh <= p.th;
    const shrink = o.needTw <= p.tw - SHRINK_W || o.needTh < p.th;
    if (!fits || shrink) return;
    o.mode = 'keep'; o.grow = false;
    o.strategy = p.strategy;
    setHall(o, p.tx, p.ty, p.tw, p.th);
    o.door = p.door; o.doorTile = p.doorTile; o.entry = p.entry;
    for (const [c, r] of p.tiles) { ensureRows(r + 1); own[r]![c] = oi; }
    for (let r = o.ty - STRIP; r < o.ty; r++) for (let c = o.tx; c < o.tx + o.tw; c++) if (own[r]![c] === -1 || own[r]![c] === COMMON) { own[r]![c] = COMMON; structural.add(K(c, r)); }
  });
  // 2. offices that outgrew their hall claim from their frontier (own wings, free space, pockets,
  //    neighbours' wings, the outdoors); offices with spare room release it. Same door when possible.
  offs.forEach((o, oi) => {
    const p = o.prev;
    if (!p || o.mode === 'keep') return;
    offs[oi] = makeDraft(groups[oi]!, cols, input.seed, p, o.prevIdx, true);
    o = offs[oi]!;
    o.strategy = p.strategy;
    for (const [c, r] of p.tiles) { ensureRows(r + 1); if (own[r]![c] === -1 || (own[r]![c] === COMMON && !structural.has(K(c, r)))) own[r]![c] = oi; }
    const anchors: [number, number][] = [[p.tx, p.ty], [p.tx + p.tw - o.needTw, p.ty]];
    let ok = false;
    for (const [tx, ty] of anchors) {
      if (!hallFree(tx, ty, o.needTw, o.needTh, oi, false, true)) continue;
      const wider = o.needTw > p.tw || o.needTh > p.th;
      o.mode = 'renovate'; o.grow = wider;
      // a shrunk hall releases its old hall tiles outside the new rect; old wings stay (trimmed later)
      const oldHall = (c: number, r: number): boolean => c >= p.tx && c < p.tx + p.tw && r >= p.ty && r < p.ty + p.th;
      setHall(o, tx, ty, o.needTw, o.needTh);
      dropTiles(oi, (c, r) => !oldHall(c, r) || inHallOf(oi, c, r));
      if (tx === p.tx && o.needTw >= p.tw) { o.door = p.door; o.doorTile = p.doorTile; o.entry = p.entry; }
      claimHall(o, oi);
      ok = true;
      break;
    }
    if (!ok) { dropTiles(oi); o.prev = null; o.prevIdx = -1; o.mode = 'new'; o.grow = true; }
  });
  // pushed neighbours keep a valid shape
  const validate = (oi: number): void => {
    const o = offs[oi]!;
    for (let pass = 0; pass < 6; pass++) {
      shapeUp(own, oi, o);
      const g = geomOf(o, oi), walk = walkableFn(own, g, []);
      const seen = reach(own, oi, o.entry, walk);
      let cut = 0;
      for (const [c, r] of tilesOf(own, oi)) if (!inHallOf(oi, c, r) && walk(c, r) && !seen.has(K(c, r))) { own[r]![c] = -1; cut++; }
      if (!cut) break;
    }
  };

  // ---- corridors: every door joins the network (lobby floor + previous corridors + routes so far)
  //      through the cheapest route over shared or free floor; new offices are placed and routed
  //      one by one, a spot whose door cannot be reached is banned and the scan goes on ----
  const network = new Set<number>();
  for (let r = lobby.ty + 2; r < lobby.ty + lobby.th; r++) for (let c = lobby.tx; c < lobby.tx + lobby.tw; c++) network.add(K(c, r));
  const routeTiles = new Set<number>();
  const passable = (c: number, r: number): boolean => { const v = own[r]![c]!; return routable(c, r) && (v === -1 || v === COMMON || isWing(c, r)); };
  const cost = (k: number): number => {
    const c = k % cols, r = Math.floor(k / cols), v = own[r]![c]!;
    return prevCorr.has(k) || network.has(k) ? 0.25 : v === COMMON ? 0.5 : v >= 0 ? 4 : 1 + tileNoise(seedN, k);
  };
  /** tiles a corridor could reach from the network right now (placement pre-check) */
  const reachableNow = (): Set<number> => {
    const seen = new Set<number>(network), q = [...network];
    for (let h = 0; h < q.length; h++) {
      const k = q[h]!, c = k % cols, r = Math.floor(k / cols);
      for (const [dc, dr] of D4) { const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue; const kk = K(cc, rr); if (!seen.has(kk) && passable(cc, rr)) { seen.add(kk); q.push(kk); } }
    }
    return seen;
  };
  const routeDoor = (o: Draft): boolean => {
    const route = makeRouter(own, cols, rows, cost, network, passable)(o.doorTile[0], o.doorTile[1]);
    const end = route[route.length - 1]!;
    if (!network.has(end)) return false;
    const take = (k: number): void => { network.add(k); routeTiles.add(k); structural.add(k); own[Math.floor(k / cols)]![k % cols] = COMMON; };
    // two tiles wide: the tile beside each fresh step (east of a vertical step, south of a horizontal one)
    const sides: number[] = [];
    route.forEach((k, i) => {
      const c = k % cols, r = Math.floor(k / cols);
      if (own[r]![c] === -1) {
        const n = route[i + 1] ?? route[i - 1] ?? k;
        const vertical = n % cols === c;
        // horizontal runs widen upward (away from the halls under the strips), vertical ones eastward
        const opts: Tile[] = vertical ? [[c + 1, r], [c - 1, r]] : [[c, r - 1], [c, r + 1]];
        for (const [sc, sr] of opts) if (routable(sc, sr) && own[sr]![sc] === -1) { sides.push(K(sc, sr)); break; }
      }
    });
    for (const k of [...route, ...sides]) { const v = own[Math.floor(k / cols)]![k % cols]!; if (v >= 0) pushed.add(v); take(k); }
    return true;
  };
  for (const o of offs) if (o.mode !== 'new' && !routeDoor(o)) { dropTiles(offs.indexOf(o)); o.prev = null; o.prevIdx = -1; o.mode = 'new'; o.grow = true; }
  // 3. newcomers and relocated offices: first spot that fits, scanning from the top
  offs.forEach((o, oi) => {
    if (o.mode !== 'new') return;
    const ltr = o.rg.f() < 0.5, jitter = o.rg.i(0, 2);
    const banned = new Set<number>();
    const reach0 = reachableNow();
    const stripOpen = (tx: number, ty: number, tw: number): boolean => { for (let r = ty - STRIP; r < ty; r++) for (let c = tx; c < tx + tw; c++) if (reach0.has(K(c, r))) return true; return false; };
    for (let attempt = 0; attempt < 8; attempt++) {
      let placed = false;
      for (let ty = OFFICE_TY0 + jitter; !placed; ty++) {
        ensureRows(ty + o.needTh + GROW_H + 3);
        for (let i = 0; i <= cols - 2 * MARGIN - o.needTw && !placed; i++) {
          const tx = ltr ? MARGIN + i : cols - MARGIN - o.needTw - i;
          if (banned.has(K(tx, ty))) continue;
          if (!hallFree(tx, ty, o.needTw, o.needTh, -99, true, false)) {
            // no rect holding the obstacle's column can stand here: jump past it
            if (blockC >= 0) i = ltr ? Math.max(i, blockC - MARGIN) : Math.max(i, cols - MARGIN - blockC - 1);
            continue;
          }
          if (!stripOpen(tx, ty, o.needTw)) continue;
          setHall(o, tx, ty, o.needTw, o.needTh); claimHall(o, oi); placed = true;
        }
        if (ty > 4000) throw new Error('world: no room for an office');
      }
      if (routeDoor(o)) return;
      banned.add(K(o.tx, o.ty));
      for (let r = o.ty - STRIP; r < o.ty; r++) for (let c = o.tx; c < o.tx + o.tw; c++) if (!network.has(K(c, r)) && !prevCorr.has(K(c, r))) { own[r]![c] = -1; structural.delete(K(c, r)); }
      dropTiles(oi);
    }
    throw new Error('world: no reachable spot for an office');
  });
  // structural floor from here on: lobby, routes and the door strips; the previous corridors nobody
  // routes through any more are plain floor again (pockets or grass)
  structural.clear();
  for (let r = lobby.ty; r < lobby.ty + lobby.th; r++) for (let c = lobby.tx; c < lobby.tx + lobby.tw; c++) structural.add(K(c, r));
  for (const k of network) structural.add(k);
  for (const o of offs) for (let r = o.ty - STRIP; r < o.ty; r++) for (let c = o.tx; c < o.tx + o.tw; c++) { own[r]![c] = COMMON; structural.add(K(c, r)); }
  for (const v of pushed) validate(v);

  // ---- territories: wings sprout with the office's strategy, then accrete in competition until
  //      the area matches the demand; a cellular pass fills notches; shapes are made valid ----
  let maxBottom = 0;
  for (const o of offs) maxBottom = Math.max(maxBottom, o.ty + o.th);
  ensureRows(Math.max(38, maxBottom + 12));
  const claimable = (c: number, r: number, oi: number): boolean => inside(c, r) && r >= offs[oi]!.ty + 2 && !structural.has(K(c, r)) && spare(c, r);
  const wanted = (input.strategies ?? []).filter((s) => getStrategy(s));
  const terr: Territory[] = [];
  offs.forEach((o, oi) => {
    if (!o.grow) return;
    if (!o.strategy || o.mode === 'new') o.strategy = o.rg.pick(wanted.length ? wanted : o.isLab ? POOL_LAB : POOL_OFFICE);
    const cx: GrowCtx = { own, cols, rows, rg: o.rg, free: claimable };
    getStrategy(o.strategy)!(o, oi, cx);
    const frac = 0.25 + o.rg.f() * 0.35;
    terr.push({ oi, hall: o, target: Math.min(40, Math.round(o.tw * o.th * frac)), reach: WING_REACH });
  });
  accrete(own, terr, claimable, seedN);
  for (const t of terr) smooth(own, t.oi, claimable);
  offs.forEach((o, oi) => { if (o.mode !== 'keep' || pushed.has(oi)) validate(oi); });

  // ---- pockets: enclosed leftovers are shared break space; a pocket enclosed by one office alone
  //      (no corridor touching it) goes to that office ----
  const isOutside = (c: number, r: number): boolean => r < INSIDE_R0 || c < EDGE || c >= cols - EDGE || r >= rows - 1;
  const settlePockets = (giveBack: boolean): number[] => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (own[r]![c] === COMMON && !structural.has(K(c, r))) own[r]![c] = -1;
    const comp = labelGrass(own, cols, rows);
    const outside = new Set<number>();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (isOutside(c, r) && comp[K(c, r)]! >= 0) outside.add(comp[K(c, r)]!);
    const byComp = new Map<number, Tile[]>();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const id = comp[K(c, r)]!; if (id >= 0 && !outside.has(id)) { const l = byComp.get(id) ?? []; l.push([c, r]); byComp.set(id, l); } }
    const touched: number[] = [];
    for (const tiles of byComp.values()) {
      const owners = new Set<number>();
      let corridor = false;
      for (const [c, r] of tiles) for (const [dc, dr] of D4) { const v = ownerAt(own, c + dc, r + dr); if (v >= 0) owners.add(v); else if (v === COMMON) corridor = true; }
      if (giveBack && !corridor && owners.size === 1) { const oi = [...owners][0]!; for (const [c, r] of tiles) own[r]![c] = oi; touched.push(oi); }
      else for (const [c, r] of tiles) own[r]![c] = COMMON;
    }
    return touched;
  };
  const got = settlePockets(true);
  if (got.length) { for (const oi of new Set(got)) validate(oi); settlePockets(false); }
  {
    let mr = 0;
    for (let r = 0; r < rows; r++) if (own[r]!.some((v) => v !== -1)) mr = r;
    rows = Math.max(38, mr + 8);
    resize(own, cols, rows);
  }
  const tilesByOffice = offs.map((_, oi) => tilesOf(own, oi));
  const corridor: number[] = [], common: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (own[r]![c] === COMMON) { const k = K(c, r); common.push(k); if (structural.has(k)) corridor.push(k); }

  // ---- outdoors: forecourt, the way to the map edge, trees in groves (blue-noise), bushes ----
  const plaza: Tile = [lobby.doorTile[0] - 1, lobby.ty - 4];
  const plazaOk = true;
  const path = new Set<number>(), ptiles: number[] = [];
  const addPath = (k: number): void => { if (!path.has(k)) { path.add(k); ptiles.push(k); } };
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) addPath(K(plaza[0] + dc, plaza[1] + dr));
  addPath(K(lobby.doorTile[0], lobby.doorTile[1]));
  const prevPath = new Set<number>(P && P.rows === rows ? P.path : []);
  if (P && P.rows !== rows) for (const k of P.path) { const c = k % P.cols, r = Math.floor(k / P.cols); if (r < rows) prevPath.add(K(c, r)); }
  {
    const grass = (c: number, r: number): boolean => own[r]![c] === -1;
    const route = makeRouter(own, cols, rows, (k) => (prevPath.has(k) ? 0.25 : 1 + tileNoise(seedN, k)), path, grass);
    const fromLeft = (seedN & 1) === 0;
    for (const k of route(fromLeft ? 0 : cols - 1, 3)) addPath(k);
  }
  const clear = (x: number, y: number, w: number, h: number): boolean => {
    const c0 = Math.floor(x / TS), c1 = Math.floor((x + w - 1) / TS), r0 = Math.floor((y - GY) / TS), r1 = Math.floor((y + h - 1 - GY) / TS);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (r < 0 || c < 0 || c >= cols || r >= rows) return false;
      if (own[r]![c] !== -1 || path.has(K(c, r))) return false;
    }
    return true;
  };
  const th = (salt: number, c: number, r: number): number => Math.floor(tileNoise(seedN ^ Math.imul(salt, 0x85ebca6b), K(c, r)) * 400);
  const grove = (c: number, r: number): boolean => tileNoise(seedN ^ 0x5bd1e995, K(c >> 2, r >> 2)) > 1.45;
  const trees: WorldLayout['trees'] = [], bushes: WorldLayout['bushes'] = [];
  for (let r = 2; r < rows - 1; r++) for (let c = 0; c < cols - 2; c++) {
    const h = th(1, c, r), every = grove(c, r) ? 9 : 30;
    if (h % every !== 0) continue;
    const x = c * TS - 3, y = GY + r * TS - 10;
    if (!clear(x, y, 14, 18)) continue;
    if (trees.some((q) => Math.abs(q.c - c) < 3 && Math.abs(q.r - r) < 3)) continue;
    trees.push({ c, r, kind: Math.floor(h / every) % 3, x, y });
  }
  for (let r = 1; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const h = th(2, c, r);
    if (h % 22 !== 0) continue;
    const x = c * TS + Math.floor(h / 22) % 3, y = GY + r * TS + 1 + Math.floor(h / 66) % 3;
    if (!clear(x, y, 8, 6) || trees.some((q) => Math.abs(q.c - c) < 2 && Math.abs(q.r - r) < 2)) continue;
    bushes.push({ c, r, x, y });
  }
  const floorDecor = input.decor.filter((d) => d.place === 'floor');
  const wallDecor = input.decor.filter((d) => d.place === 'wall');
  const outdoor: PlacedDecor[] = [];
  if (floorDecor.length) {
    const d = floorDecor[th(3, plaza[0], plaza[1]) % floorDecor.length]!;
    outdoor.push({ id: d.id, x: plaza[0] * TS + 12 - (d.w >> 1), y: GY + plaza[1] * TS + 20 - d.h, w: d.w, h: d.h });
  }
  if (floorDecor.length) for (let r = 2; r < rows - 2 && outdoor.length < 4; r++) for (let c = 1; c < cols - 3 && outdoor.length < 4; c++) {
    const h = th(4, c, r);
    if (h % 150 !== 0) continue;
    const d = floorDecor[Math.floor(h / 150) % floorDecor.length]!;
    const x = c * TS, y = GY + r * TS + 8 - d.h;
    if (!clear(x - 2, y - 2, d.w + 4, d.h + 4) || trees.some((q) => Math.abs(q.c - c) < 3 && Math.abs(q.r - r) < 3)) continue;
    outdoor.push({ id: d.id, x, y, w: d.w, h: d.h });
  }

  // ---- finish offices: wall features, furniture (standing offices keep what still stands) ----
  const features = offs.map((o, oi): { windows: number[]; poster: number | null; wallDeco: PlacedDecor[]; decor: PlacedDecor[] } => {
    const p = o.prev;
    const sameFront = !!p && p.tw === o.tw && p.door === o.door && p.tx === o.tx;
    const ft = { windows: sameFront ? p!.windows : [] as number[], poster: sameFront ? p!.poster : null as number | null, wallDeco: sameFront ? p!.wallDeco : [] as PlacedDecor[], decor: [] as PlacedDecor[] };
    if (!sameFront) planWall(o, o.rg, wallDecor, ft);
    const g = geomOf(o, oi);
    if (p) for (const d of p.decor) if (!placementProblem(own, g, d, ft.decor)) ft.decor.push(d);
    if (o.mode === 'keep' && !pushed.has(oi)) return ft;
    const basic = o.racks ? ['plant', 'lamp', 'shelf'] : o.isLab ? ['plant', 'lamp', 'cooler'] : ['plant', 'sofa', 'cooler', 'table', 'shelf', 'lamp'];
    const size = (id: string): [number, number] => DECO_SIZE[id] ?? ((): [number, number] => { const d = floorDecor.find((p) => p.id === id); return d ? [d.w, d.h] : [8, 8]; })();
    const pick = () => { const id = floorDecor.length && o.rg.f() < 0.55 ? o.rg.pick(floorDecor).id : o.rg.pick(basic); const s = size(id); return { id, w: s[0], h: s[1] }; };
    const want = o.rg.i(2, 4);
    if (o.mode !== 'keep') ft.decor = planFurniture(own, g, o.rg, pick, Math.max(0, want - ft.decor.length), ft.decor);
    return ft;
  });
  const commonDecor = planCommonDecor(own, cols, rows, structural, seedN, P ? P.commonDecor : [], floorDecor);

  // ---- timeline: every tile whose content changed is demolished (old art shown until then) and
  //      built by the crew of its new owner; corridors first, then offices, then roads and nature ----
  const catPrev = (c: number, r: number): string => { if (!P || r >= P.rows) return 'g'; const v = P.own[r]![c]!; return v >= 0 ? 'o:' + P.offices[v]!.id : v === COMMON ? 'c' : 'g'; };
  const catNow = (c: number, r: number): string => { const v = own[r]![c]!; return v >= 0 ? 'o:' + offs[v]!.id : v === COMMON ? 'c' : 'g'; };
  const lost = new Map<string, Tile[]>(), gained = new Map<string, Tile[]>();
  for (let r = 0; r < Math.max(rows, P ? P.rows : 0); r++) for (let c = 0; c < cols; c++) {
    const a = catPrev(c, r), b = r < rows ? catNow(c, r) : 'g';
    if (a === b) continue;
    if (a !== 'g') { const l = lost.get(a) ?? []; l.push([c, r]); lost.set(a, l); }
    if (b !== 'g') { const l = gained.get(b) ?? []; l.push([c, r]); gained.set(b, l); }
  }
  const reveal: RevealItem[] = [], demolish: RevealItem[] = [], crews: Crew[] = [];
  let t = 0, k = 0;
  const prevEntry = (id: string): Tile => (id === 'c' ? lobby.entry : P?.offices.find((o) => o.id === id.slice(2))?.entry ?? [0, 0]);
  for (const [id, tiles] of lost) {
    const start = 0.1 + k * 0.2, dur = 0.4 + tiles.length * 0.003;
    const order = orderFrom(tiles, prevEntry(id));
    order.forEach((tl, i) => demolish.push({ kind: 'office', x: tl[0] * TS, y: GY + tl[1] * TS, w: TS, h: TS, time: start + (i / Math.max(1, order.length)) * dur }));
    crews.push({ id: id === 'c' ? '@common' : id.slice(2), kind: 'demolish', order, start, dur });
    t = Math.max(t, start + dur + 0.3);
    k++;
  }
  if (P) {
    for (const kk of P.path) { const c = kk % P.cols, r = Math.floor(kk / P.cols); if (!path.has(K(c, r)) || r >= rows) demolish.push({ kind: 'path', x: c * TS, y: GY + r * TS, w: TS, h: TS, time: 0 }); }
    for (const tr of P.trees) if (!trees.some((q) => q.c === tr.c && q.r === tr.r)) demolish.push({ kind: 'tree', x: tr.x, y: tr.y, w: 14, h: 18, time: 0 });
    for (const b of P.bushes) if (!bushes.some((q) => q.c === b.c && q.r === b.r)) demolish.push({ kind: 'bush', x: b.x, y: b.y, w: 8, h: 6, time: 0 });
    for (const d of P.outdoor) if (!outdoor.some((q) => q.x === d.x && q.y === d.y && q.id === d.id)) demolish.push({ kind: 'outdoor', x: d.x, y: d.y, w: d.w, h: d.h, time: 0 });
  }
  const timing = offs.map(() => ({ start: -1, dur: 0, done: -1 }));
  const orders = offs.map((o, oi) => floodOrder(own, oi, [o.doorTile[0], o.ty]));
  k = 0;
  const buildCrew = (id: string, tiles: Tile[], from: Tile): { start: number; dur: number; done: number } => {
    const order = orderFrom(tiles, from);
    const bs = t + 0.5 + k * 0.45, bd = 2 + order.length * 0.0045;
    order.forEach((tl, i) => reveal.push({ kind: 'office', x: tl[0] * TS, y: GY + tl[1] * TS, w: TS, h: TS, time: bs + (i / order.length) * bd }));
    crews.push({ id, kind: 'build', order, start: bs, dur: bd });
    k++;
    return { start: bs, dur: bd, done: bs + bd + 0.25 };
  };
  if (gained.has('c')) buildCrew('@common', gained.get('c')!, lobby.entry);
  offs.forEach((o, oi) => {
    const g = gained.get('o:' + o.id);
    if (!g) return;
    timing[oi] = buildCrew(o.id, g, [o.doorTile[0], o.ty]);
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
  const changedFlag = (o: Draft): boolean => (P && !changedGeo ? !!o.prev?.changed : gained.has('o:' + o.id) || lost.has('o:' + o.id));
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
    seed: input.seed, season, cols, rows, own, offices, lobby, corridor, common, commonDecor, plaza, plazaOk, path: ptiles, trees, bushes, outdoor,
    build, epoch, order: orderHints,
  };
}

/** BFS order over a tile list from `start` (for demolition of a previous office). */
function orderFrom(tiles: Tile[], start: Tile): Tile[] {
  if (!tiles.length) return [];
  const W = 1 << 12;
  const key = (c: number, r: number): number => (r + 1) * W + c + 1;
  const set = new Map<number, Tile>();
  for (const t of tiles) set.set(key(t[0], t[1]), t);
  const first = set.get(key(start[0], start[1])) ?? tiles.reduce((b, t) => (Math.abs(t[0] - start[0]) + Math.abs(t[1] - start[1]) < Math.abs(b[0] - start[0]) + Math.abs(b[1] - start[1]) ? t : b), tiles[0]!);
  const seen = new Set<number>([key(first[0], first[1])]), q: Tile[] = [first], out: Tile[] = [];
  for (let h = 0; h < q.length; h++) {
    const t = q[h]!; out.push(t);
    for (const [dc, dr] of D4) {
      const kk = key(t[0] + dc, t[1] + dr), n = set.get(kk);
      if (n && !seen.has(kk)) { seen.add(kk); q.push(n); }
    }
  }
  for (const t of tiles) if (!seen.has(key(t[0], t[1]))) out.push(t);
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

/** Why `d` cannot stand in the break pockets ('' = fine): on pocket tiles only, against a wall, 2 px from others. */
export function commonProblem(own: Own, structural: Set<number>, d: PlacedDecor, others: readonly PlacedDecor[]): string {
  const cols = own[0]?.length ?? 0;
  const c0 = Math.floor(d.x / TS), c1 = Math.floor((d.x + d.w - 1) / TS), r0 = Math.floor((d.y - GY) / TS), r1 = Math.floor((d.y + d.h - 1 - GY) / TS);
  if (d.y < GY) return 'por encima del mapa';
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (ownerAt(own, c, r) !== COMMON || structural.has(r * cols + c)) return 'fuera de la zona comun';
  for (const o of others) {
    if (o === d) continue;
    if (d.x < o.x + o.w + 2 && o.x < d.x + d.w + 2 && d.y < o.y + o.h + 2 && o.y < d.y + d.h + 2) return 'solapa otro mueble';
  }
  let wall = false;
  for (let c = c0; c <= c1 && !wall; c++) if (ownerAt(own, c, r1 + 1) !== COMMON || ownerAt(own, c, r0 - 1) !== COMMON) wall = true;
  if (ownerAt(own, c0 - 1, r1) !== COMMON || ownerAt(own, c1 + 1, r1) !== COMMON) wall = true;
  return wall ? '' : 'en medio de la zona comun';
}

/** Plants in the corners and a few seats in the break pockets; items that still stand are kept. */
function planCommonDecor(own: Own, cols: number, rows: number, structural: Set<number>, seedN: number, prev: readonly PlacedDecor[], floorDecor: DecorItem[]): PlacedDecor[] {
  const out: PlacedDecor[] = [];
  for (const d of prev) if (!commonProblem(own, structural, d, out)) out.push(d);
  const pockets = labelGrass(own, cols, rows, (v) => v === COMMON);
  const byComp = new Map<number, Tile[]>();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (own[r]![c] !== COMMON || structural.has(r * cols + c)) continue;
    const id = pockets[r * cols + c]!;
    const l = byComp.get(id) ?? []; l.push([c, r]); byComp.set(id, l);
  }
  const corner = (c: number, r: number): boolean => {
    let walls = 0;
    for (const [dc, dr] of D4) if (ownerAt(own, c + dc, r + dr) !== COMMON) walls++;
    return walls >= 2;
  };
  for (const tiles of byComp.values()) {
    const first = tiles[0]!;
    const rg = makeRng(seedN ^ Math.imul(first[1] * cols + first[0] + 1, 0x27d4eb2d));
    const have = out.filter((d) => tiles.some(([c, r]) => c === Math.floor(d.x / TS) && r === Math.floor((d.y + d.h - 1 - GY) / TS))).length;
    let want = Math.min(4, Math.ceil(tiles.length / 5)) - have;
    const corners = tiles.filter(([c, r]) => corner(c, r));
    const size = (id: string): [number, number] => DECO_SIZE[id] ?? ((): [number, number] => { const fd = floorDecor.find((x) => x.id === id); return fd ? [fd.w, fd.h] : [8, 8]; })();
    const tryAt = (t: Tile, id: string): boolean => {
      const s = size(id);
      const d: PlacedDecor = { id, x: t[0] * TS + 1 + rg.i(0, 2), y: GY + t[1] * TS + TS - 1 - s[1], w: s[0], h: s[1] };
      if (commonProblem(own, structural, d, out)) return false;
      out.push(d);
      return true;
    };
    for (let tries = 0; want > 0 && corners.length && tries < 12; tries++) if (tryAt(rg.pick(corners), 'plant')) want--;
    const seats = floorDecor.length && rg.f() < 0.3 ? [rg.pick(floorDecor).id] : ['sofa', 'table', 'cooler'];
    for (let tries = 0; want > 0 && tries < 24; tries++) {
      if (tryAt(rg.pick(tiles), rg.pick(seats))) want--;
    }
  }
  return out;
}
