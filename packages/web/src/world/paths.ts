/**
 * Plaza and paths. The network is grown like Prim's MST over the doors: the plaza seeds it and every
 * door, in turn, joins through the cheapest route (Dijkstra, multi-target: it stops at the first
 * network tile). Costs: 1 + per-tile noise (meandering), 0.25 on tiles that were already path in the
 * previous layout, so a new office adds a spur instead of redrawing the town's roads.
 */
import { D4, type Own, labelGrass } from './grid.js';
import type { Tile } from './types.js';

/** Per-tile noise in [0, 2.5) from the seed hash and the tile key (stable: no sequential rng). */
export function tileNoise(seedN: number, k: number): number {
  let n = (seedN ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  n ^= n >>> 15; n = Math.imul(n, 0x2c1b3c6d); n ^= n >>> 12; n = Math.imul(n, 0x297a2d39); n ^= n >>> 15;
  return ((n >>> 0) % 1000) / 400;
}

/** 3×3 grass squares with a tile of grass around, in the grass component holding most doors. */
export function plazaCandidates(own: Own, cols: number, rows: number, doors: Tile[]): Tile[] {
  const comp = labelGrass(own, cols, rows);
  const count = new Map<number, number>();
  for (const d of doors) {
    if (d[1] < 0 || d[1] >= rows) continue;
    const cc = comp[d[1] * cols + d[0]]!;
    if (cc >= 0) count.set(cc, (count.get(cc) ?? 0) + 1);
  }
  let main = -1, best = 0;
  for (const [cc, k] of count) if (k > best) { best = k; main = cc; }
  const out: Tile[] = [];
  for (let r = 1; r < rows - 3; r++) for (let c = 1; c < cols - 3; c++) {
    if (main >= 0 && comp[(r + 1) * cols + c + 1] !== main) continue;
    let ok = true;
    for (let dr = -1; dr <= 3 && ok; dr++) for (let dc = -1; dc <= 3 && ok; dc++) if (own[r + dr]![c + dc] !== -1) ok = false;
    if (ok) out.push([c, r]);
  }
  return out;
}

/** The candidate closest (sum of Manhattan distances) to the doors; ties by position. */
export function centralPlaza(cands: Tile[], doors: Tile[]): Tile | null {
  let best: Tile | null = null, bd = Infinity;
  for (const p of cands) {
    let d = 0;
    for (const t of doors) d += Math.abs(t[0] - p[0] - 1) + Math.abs(t[1] - p[1] - 1);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/**
 * Cheapest route from (sc, sr) to any tile of `path`; returns the tiles including both ends.
 * `passable(c, r)` says which tiles may carry the route (default: grass).
 */
export function makeRouter(own: Own, cols: number, rows: number, cost: (k: number) => number, path: Set<number>, passable?: (c: number, r: number) => boolean) {
  const N = cols * rows;
  const ok = passable ?? ((c: number, r: number): boolean => own[r]![c] === -1);
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
    if (sr < 0 || sr >= rows || sc < 0 || sc >= cols) return [];
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
      for (const [dc, dr] of D4) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows || !ok(cc, rr)) continue;
        const kk = rr * cols + cc, nd = d0 + cost(kk);
        if (nd < dist[kk]!) { dist[kk] = nd; prev[kk] = k; push(nd, kk); }
      }
    }
    return [s];
  };
}
