/**
 * The tile grid of the town: ownership per tile, neighbour masks (autotiling), shape rules and
 * reachability. Pure helpers shared by the generator, the painter and the tests.
 *
 * Shape rule: every tile of an office belongs to at least one fully-owned 2×2 block (no 1-tile
 * spikes or corridors), and every tile is 4-connected to the hall. Wings that break the rule are
 * trimmed until it holds, so walls always close and the floor reads as rooms.
 */
import type { Tile } from './types.js';

export const D4: readonly Tile[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Edge bits of `edgeMask`: the neighbour on that side is NOT the same office. */
export const N = 1, E = 2, S = 4, W = 8;

export type Own = number[][];

export function key(cols: number, c: number, r: number): number { return r * cols + c; }

export function ownerAt(own: Own, c: number, r: number): number {
  const row = own[r];
  return row && c >= 0 && c < row.length ? row[c]! : -1;
}

/** Grows `own` to `rows` rows (new rows are grass) or trims it. */
export function resize(own: Own, cols: number, rows: number): void {
  while (own.length < rows) own.push(new Array<number>(cols).fill(-1));
  own.length = rows;
}

/** 4-neighbour mask of tile (c, r) for office `oi`: bits N/E/S/W set where the neighbour is not `oi`. */
export function edgeMask(own: Own, c: number, r: number, oi: number): number {
  let m = 0;
  if (ownerAt(own, c, r - 1) !== oi) m |= N;
  if (ownerAt(own, c + 1, r) !== oi) m |= E;
  if (ownerAt(own, c, r + 1) !== oi) m |= S;
  if (ownerAt(own, c - 1, r) !== oi) m |= W;
  return m;
}

/** Tiles owned by `oi`, row-major. */
export function tilesOf(own: Own, oi: number): Tile[] {
  const out: Tile[] = [];
  for (let r = 0; r < own.length; r++) { const row = own[r]!; for (let c = 0; c < row.length; c++) if (row[c] === oi) out.push([c, r]); }
  return out;
}

/** True when (c, r) is the top-left of a 2×2 block fully owned by `oi`. */
function block2(own: Own, c: number, r: number, oi: number): boolean {
  return ownerAt(own, c, r) === oi && ownerAt(own, c + 1, r) === oi && ownerAt(own, c, r + 1) === oi && ownerAt(own, c + 1, r + 1) === oi;
}

/**
 * Enforces the shape rule on office `oi` around a hall that is never trimmed: drops tiles outside
 * any owned 2×2 block, then tiles not 4-connected to the hall, until nothing changes.
 * Returns the number of tiles removed.
 */
export function shapeUp(own: Own, oi: number, hall: { tx: number; ty: number; tw: number; th: number }): number {
  let removed = 0;
  const inHall = (c: number, r: number): boolean => c >= hall.tx && c < hall.tx + hall.tw && r >= hall.ty && r < hall.ty + hall.th;
  for (let pass = 0; pass < 50; pass++) {
    let changed = 0;
    for (const [c, r] of tilesOf(own, oi)) {
      if (inHall(c, r)) continue;
      if (block2(own, c, r, oi) || block2(own, c - 1, r, oi) || block2(own, c, r - 1, oi) || block2(own, c - 1, r - 1, oi)) continue;
      own[r]![c] = -1; changed++;
    }
    // connectivity to the hall
    const seen = new Set<number>(), q: Tile[] = [];
    const cols = own[0]?.length ?? 0;
    for (const [c, r] of tilesOf(own, oi)) if (inHall(c, r)) { seen.add(key(cols, c, r)); q.push([c, r]); }
    for (let h = 0; h < q.length; h++) {
      const [c, r] = q[h]!;
      for (const [dc, dr] of D4) {
        const cc = c + dc, rr = r + dr, k = key(cols, cc, rr);
        if (ownerAt(own, cc, rr) === oi && !seen.has(k)) { seen.add(k); q.push([cc, rr]); }
      }
    }
    for (const [c, r] of tilesOf(own, oi)) if (!seen.has(key(cols, c, r))) { own[r]![c] = -1; changed++; }
    removed += changed;
    if (!changed) break;
  }
  return removed;
}

/** Tiles of `oi` 4-reachable from `start` through tiles where `walkable(c, r)` holds. */
export function reach(own: Own, oi: number, start: Tile, walkable: (c: number, r: number) => boolean): Set<number> {
  const cols = own[0]?.length ?? 0;
  const seen = new Set<number>();
  if (ownerAt(own, start[0], start[1]) !== oi || !walkable(start[0], start[1])) return seen;
  const q: Tile[] = [start];
  seen.add(key(cols, start[0], start[1]));
  for (let h = 0; h < q.length; h++) {
    const [c, r] = q[h]!;
    for (const [dc, dr] of D4) {
      const cc = c + dc, rr = r + dr, k = key(cols, cc, rr);
      if (seen.has(k) || ownerAt(own, cc, rr) !== oi || !walkable(cc, rr)) continue;
      seen.add(k); q.push([cc, rr]);
    }
  }
  return seen;
}

/** Connected components of grass tiles (-1 for non-grass). */
export function labelGrass(own: Own, cols: number, rows: number): Int32Array {
  const comp = new Int32Array(cols * rows).fill(-1);
  let id = 0;
  const stack: number[] = [];
  for (let s = 0; s < comp.length; s++) {
    if (comp[s] !== -1 || own[Math.floor(s / cols)]![s % cols] !== -1) continue;
    comp[s] = id; stack.push(s);
    while (stack.length) {
      const k = stack.pop()!, c = k % cols, r = (k / cols) | 0;
      for (const [dc, dr] of D4) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const kk = rr * cols + cc;
        if (comp[kk] === -1 && own[rr]![cc] === -1) { comp[kk] = id; stack.push(kk); }
      }
    }
    id++;
  }
  return comp;
}

/** Breadth-first order of the tiles of `oi` from `start` (the build/demolition order). */
export function floodOrder(own: Own, oi: number, start: Tile): Tile[] {
  const cols = own[0]?.length ?? 0;
  const order: Tile[] = [];
  if (ownerAt(own, start[0], start[1]) !== oi) {
    const all = tilesOf(own, oi);
    if (!all.length) return order;
    start = all.reduce((b, t) => (Math.abs(t[0] - start[0]) + Math.abs(t[1] - start[1]) < Math.abs(b[0] - start[0]) + Math.abs(b[1] - start[1]) ? t : b));
  }
  const seen = new Set<number>([key(cols, start[0], start[1])]), q: Tile[] = [start];
  for (let h = 0; h < q.length; h++) {
    const t = q[h]!; order.push(t);
    for (const [dc, dr] of D4) {
      const c = t[0] + dc, r = t[1] + dr, k = key(cols, c, r);
      if (ownerAt(own, c, r) !== oi || seen.has(k)) continue;
      seen.add(k); q.push([c, r]);
    }
  }
  // tiles in other components (should not happen after shapeUp) go last
  for (const t of tilesOf(own, oi)) if (!seen.has(key(cols, t[0], t[1]))) order.push(t);
  return order;
}
