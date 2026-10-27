/**
 * Territories on the shared floor: every office grows out of its hall by frontier accretion (an
 * Eden-like process) in competition with its neighbours, until its area matches its demand. The
 * frontier tile that joins next is the one closest to the hall, best enclosed by the office and
 * favoured by a per-tile noise, so borders come out organic but compact (a discrete weighted
 * Voronoi / power-diagram partition where the weight is the remaining demand). A short cellular
 * pass then fills notches, so no useless one-tile holes remain. See docs/world.md.
 */
import { D4, type Own, ownerAt } from './grid.js';
import { tileNoise } from './paths.js';
import type { Tile } from './types.js';

export interface Territory {
  oi: number;
  hall: { tx: number; ty: number; tw: number; th: number };
  /** tiles wanted beyond the hall */
  target: number;
  /** max Chebyshev distance from the hall rect */
  reach: number;
}

/** Chebyshev distance from (c, r) to the hall rect (0 inside). */
export function hallDist(h: { tx: number; ty: number; tw: number; th: number }, c: number, r: number): number {
  const dc = c < h.tx ? h.tx - c : c >= h.tx + h.tw ? c - (h.tx + h.tw - 1) : 0;
  const dr = r < h.ty ? h.ty - r : r >= h.ty + h.th ? r - (h.ty + h.th - 1) : 0;
  return Math.max(dc, dr);
}

function area(own: Own, oi: number): number {
  let n = 0;
  for (const row of own) for (const v of row) if (v === oi) n++;
  return n;
}

/**
 * Grows every territory in rounds: each round, the offices still short of their target (most
 * starved first) claim their best frontier tile. `claimable(c, r, oi)` tells which tiles may be
 * taken. Returns when nobody can grow any more.
 */
export function accrete(own: Own, terr: Territory[], claimable: (c: number, r: number, oi: number) => boolean, seedN: number): void {
  const cols = own[0]?.length ?? 0;
  const have = terr.map((t) => area(own, t.oi) - t.hall.tw * t.hall.th);
  const stuck = terr.map(() => false);
  // frontier candidates per territory, seeded from its tiles and extended as it grows
  const cand = terr.map((t) => {
    const set = new Set<number>();
    for (let r = 0; r < own.length; r++) { const row = own[r]!; for (let c = 0; c < row.length; c++) if (row[c] === t.oi) for (const [dc, dr] of D4) set.add((r + dr) * cols + c + dc); }
    return set;
  });
  for (let round = 0; round < 400; round++) {
    const live = terr.map((t, i) => i).filter((i) => !stuck[i] && have[i]! < terr[i]!.target);
    if (!live.length) break;
    live.sort((a, b) => (have[b]! / Math.max(1, terr[b]!.target)) - (have[a]! / Math.max(1, terr[a]!.target)) || a - b);
    for (const i of live.reverse()) {
      const t = terr[i]!;
      const best = bestFrontier(own, t, cand[i]!, claimable, seedN, cols);
      if (!best) { stuck[i] = true; continue; }
      own[best[1]]![best[0]] = t.oi;
      for (const [dc, dr] of D4) cand[i]!.add((best[1] + dr) * cols + best[0] + dc);
      have[i]!++;
    }
  }
}

function bestFrontier(own: Own, t: Territory, cand: Set<number>, claimable: (c: number, r: number, oi: number) => boolean, seedN: number, cols: number): Tile | null {
  let best: Tile | null = null, bs = Infinity;
  for (const k of cand) {
    const cc = k % cols, rr = Math.floor(k / cols);
    if (rr < 0 || cc < 0 || cc >= cols || ownerAt(own, cc, rr) === t.oi) { cand.delete(k); continue; }
    if (!claimable(cc, rr, t.oi)) continue;
    const d = hallDist(t.hall, cc, rr);
    if (d > t.reach) { cand.delete(k); continue; }
    let around = 0;
    for (const [ec, er] of D4) if (ownerAt(own, cc + ec, rr + er) === t.oi) around++;
    const s = d * 1.0 - around * 0.6 + tileNoise(seedN ^ Math.imul(t.oi + 1, 0x9e3779b1), k) * 0.9;
    if (s < bs) { bs = s; best = [cc, rr]; }
  }
  if (best) cand.delete(best[1] * cols + best[0]);
  return best;
}

/**
 * Cellular smoothing of one territory: a claimable tile with 3 or more 4-neighbours in the office
 * joins it (notches and one-tile holes disappear). Two passes; returns the tiles added.
 */
export function smooth(own: Own, oi: number, claimable: (c: number, r: number, oi: number) => boolean): number {
  const cols = own[0]?.length ?? 0;
  let added = 0;
  for (let pass = 0; pass < 2; pass++) {
    const adds: Tile[] = [];
    const seen = new Set<number>();
    for (let r = 0; r < own.length; r++) for (let c = 0; c < cols; c++) {
      if (own[r]![c] !== oi) continue;
      for (const [dc, dr] of D4) {
        const cc = c + dc, rr = r + dr, k = rr * cols + cc;
        if (seen.has(k)) continue;
        seen.add(k);
        if (!claimable(cc, rr, oi)) continue;
        let n = 0;
        for (const [ec, er] of D4) if (ownerAt(own, cc + ec, rr + er) === oi) n++;
        if (n >= 3) adds.push([cc, rr]);
      }
    }
    for (const [c, r] of adds) own[r]![c] = oi;
    added += adds.length;
    if (!adds.length) break;
  }
  return added;
}
