/**
 * Furniture rules. An office hall (tiles, relative rows) is a stack of bands:
 *   0-1  facade: wall with the sign, door and windows
 *   2-3  lane: walkers come in from the door and walk behind the desks (free of furniture)
 *   4-9  desk band (+5 rows per extra desk row): rugs, desks and chairs between startX and deskX1
 *   last 3 rows  furniture band: decor stands against the back/side/bottom walls
 * Wing tiles (outside the hall rect) are floor for decor; a wing tile whose north neighbour is not
 * the office carries a low wall on its top 7 px, so nothing stands on it.
 *
 * A placement is valid when the whole sprite lies on tiles of the office, its footprint (bottom tile
 * row) is not on a wall, lane, desk or gauge tile, it keeps 2 px from other items, it touches a
 * wall (back, side or bottom), and every walkable tile stays reachable from the entry tile.
 */
import { type Own, N, edgeMask, ownerAt, reach } from './grid.js';
import type { Rng } from './rng.js';
import { GY, TS, type PlacedDecor, type Tile } from './types.js';

export const FACADE_ROWS = 2;
export const LANE_ROWS = 2;
export const DESK_BAND_ROWS = 6; // rug: dy-26 .. dy+16 → rows 4..9 of the hall
export const ITEM_BAND_ROWS = 3;
export const GAUGE_COLS = 3; // thermometer + piggy bank column at the right of the hall
export const ITEM_GAP = 2;

/** Geometry of one office the rules need (px and tiles). */
export interface OfficeGeom {
  oi: number;
  tx: number; ty: number; tw: number; th: number;
  deskRows: number;
  rowPitch: number; // tiles
  /** px range of the desks/rugs inside the hall, relative to x */
  deskX0: number; deskX1: number;
  /** tiles of the racks (server rooms) relative to the hall, or null */
  racks: { c0: number; c1: number; r0: number; r1: number } | null;
  entry: Tile;
}

export function isHall(g: OfficeGeom, c: number, r: number): boolean {
  return c >= g.tx && c < g.tx + g.tw && r >= g.ty && r < g.ty + g.th;
}

/** A wing tile with a low wall on top (its north neighbour belongs to someone else). */
export function isWallTile(own: Own, g: OfficeGeom, c: number, r: number): boolean {
  return !isHall(g, c, r) && ownerAt(own, c, r) === g.oi && (edgeMask(own, c, r, g.oi) & N) !== 0;
}

/** Tile under desks/rugs (blocked) — only inside the hall's desk bands and the desk px range. */
export function isDeskTile(g: OfficeGeom, c: number, r: number): boolean {
  if (!isHall(g, c, r)) return false;
  const rr = r - g.ty, c0 = Math.floor(g.deskX0 / TS), c1 = Math.floor((g.deskX1 - 1) / TS);
  const cc = c - g.tx;
  if (cc < c0 || cc > c1) return false;
  for (let k = 0; k < g.deskRows; k++) {
    const r0 = FACADE_ROWS + LANE_ROWS + k * g.rowPitch;
    if (rr >= r0 && rr < r0 + DESK_BAND_ROWS) return true;
  }
  return false;
}

export function isFacade(g: OfficeGeom, c: number, r: number): boolean { return isHall(g, c, r) && r - g.ty < FACADE_ROWS; }
export function isLane(g: OfficeGeom, c: number, r: number): boolean { const rr = r - g.ty; return isHall(g, c, r) && rr >= FACADE_ROWS && rr < FACADE_ROWS + LANE_ROWS; }
export function isRack(g: OfficeGeom, c: number, r: number): boolean {
  const k = g.racks;
  return !!k && c - g.tx >= k.c0 && c - g.tx <= k.c1 && r - g.ty >= k.r0 && r - g.ty <= k.r1;
}
export function isGauge(g: OfficeGeom, c: number, r: number): boolean {
  return isHall(g, c, r) && c - g.tx >= g.tw - GAUGE_COLS && r - g.ty >= FACADE_ROWS;
}
/** Hall tile in the furniture band (last rows). */
export function isItemBand(g: OfficeGeom, c: number, r: number): boolean { return isHall(g, c, r) && r - g.ty >= g.th - ITEM_BAND_ROWS; }

/** Footprint row and columns of a sprite rect (its bottom tile row). */
export function footprint(d: { x: number; y: number; w: number; h: number }): { r: number; c0: number; c1: number } {
  return { r: Math.floor((d.y + d.h - 1 - GY) / TS), c0: Math.floor(d.x / TS), c1: Math.floor((d.x + d.w - 1) / TS) };
}

/** Walkability of a tile for office `g` given the furniture placed so far. */
export function walkableFn(own: Own, g: OfficeGeom, decor: readonly PlacedDecor[]): (c: number, r: number) => boolean {
  const blocked = new Set<number>();
  const cols = own[0]?.length ?? 0;
  for (const d of decor) { const f = footprint(d); for (let c = f.c0; c <= f.c1; c++) blocked.add(f.r * cols + c); }
  return (c, r) => {
    if (ownerAt(own, c, r) !== g.oi) return false;
    if (isFacade(g, c, r) || isRack(g, c, r) || isDeskTile(g, c, r) || isWallTile(own, g, c, r)) return false;
    return !blocked.has(r * cols + c);
  };
}

/** Why `d` cannot stand there ('' = fine). `others` = the furniture already placed. */
export function placementProblem(own: Own, g: OfficeGeom, d: PlacedDecor, others: readonly PlacedDecor[]): string {
  const f = footprint(d);
  const r0 = Math.floor((d.y - GY) / TS);
  if (d.y < GY) return 'por encima del mapa';
  for (let r = r0; r <= f.r; r++) for (let c = f.c0; c <= f.c1; c++) {
    if (ownerAt(own, c, r) !== g.oi) return 'fuera de su oficina';
    if (isFacade(g, c, r) || isLane(g, c, r) || isDeskTile(g, c, r) || isGauge(g, c, r) || isRack(g, c, r)) return 'sobre fachada, pasillo, mesas o termometro';
  }
  for (let c = f.c0; c <= f.c1; c++) if (isWallTile(own, g, c, f.r)) return 'sobre un muro';
  if (isHall(g, f.c0, f.r) && !isItemBand(g, f.c0, f.r)) return 'fuera de la banda de muebles';
  for (const o of others) {
    if (o === d) continue;
    if (d.x < o.x + o.w + ITEM_GAP && o.x < d.x + d.w + ITEM_GAP && d.y < o.y + o.h + ITEM_GAP && o.y < d.y + d.h + ITEM_GAP) return 'solapa otro mueble';
  }
  // against a wall: bottom edge (south not owned), side edge, or back wall (north tile is wall/facade)
  let wall = false;
  for (let c = f.c0; c <= f.c1 && !wall; c++) {
    if (ownerAt(own, c, f.r + 1) !== g.oi) wall = true;
    const up = f.r - 1;
    if (ownerAt(own, c, up) !== g.oi || isWallTile(own, g, c, up) || isFacade(g, c, up) || isDeskTile(g, c, up)) wall = true;
  }
  if (ownerAt(own, f.c0 - 1, f.r) !== g.oi || ownerAt(own, f.c1 + 1, f.r) !== g.oi) wall = true;
  if (!wall) return 'en medio de la sala';
  const walk = walkableFn(own, g, [...others.filter((o) => o !== d), d]);
  const seen = reach(own, g.oi, g.entry, walk);
  for (let r = 0; r < own.length; r++) for (let c = 0; c < (own[0]?.length ?? 0); c++) if (walk(c, r) && !seen.has(r * (own[0]?.length ?? 0) + c)) return 'corta el paso';
  return '';
}

export interface ItemSize { id: string; w: number; h: number }

/**
 * Places furniture in the hall band (2-4 items) and the wings (1 per ~9 tiles, max 5) following the
 * rules. Deterministic for a given rng.
 */
export function planFurniture(own: Own, g: OfficeGeom, rg: Rng, pick: () => ItemSize, hallCount: number): PlacedDecor[] {
  const out: PlacedDecor[] = [];
  const tiles: Tile[] = [];
  for (let r = 0; r < own.length; r++) for (let c = 0; c < (own[0]?.length ?? 0); c++) if (own[r]![c] === g.oi) tiles.push([c, r]);
  const hallBand = tiles.filter(([c, r]) => isItemBand(g, c, r) && !isGauge(g, c, r));
  const wing = tiles.filter(([c, r]) => !isHall(g, c, r) && !isWallTile(own, g, c, r));
  const tryAt = (t: Tile, it: ItemSize): boolean => {
    const x = t[0] * TS + 1 + rg.i(0, 2), y = GY + t[1] * TS + TS - 1 - it.h; // 1 px off the outline
    const d: PlacedDecor = { id: it.id, x, y, w: it.w, h: it.h };
    if (placementProblem(own, g, d, out)) return false;
    out.push(d);
    return true;
  };
  for (let n = hallCount, tries = 0; n > 0 && hallBand.length && tries < 40; tries++) if (tryAt(rg.pick(hallBand), pick())) n--;
  for (let m = Math.min(5, Math.ceil(wing.length / 9)), tries = 0; m > 0 && wing.length && tries < 60; tries++) if (tryAt(rg.pick(wing), pick())) m--;
  return out;
}
