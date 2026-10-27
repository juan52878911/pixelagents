/**
 * Static world art (port of drawWorld): grass, paths and plaza, office floors/walls/signs, racks,
 * thermometer stands, bushes and trees, into two buffers — `terrain` (grass only) and `full`.
 * During the build animation the visible world is terrain + the revealed rects of `full`.
 */
import { FONT_4x6, FONT_5x7, measure } from '../engine/fonts.js';
import { BufferPainter } from '../engine/painter.js';
import { signParts } from '../world/generate.js';
import { E as EB, N as NB, S as SB, W as WB, edgeMask } from '../world/grid.js';
import { SEASONS, type SeasonPalette } from '../world/seasons.js';
import { GY, TS, type FloorKind, type OfficeLayout, type WorldLayout } from '../world/types.js';
import type { Art } from './art.js';
import { OL } from './chars.js';
import { drawRack, hash } from './props.js';

/** Palette shared by every office: outline, shadows, the wall trim and the sign. */
export const PAL = {
  outline: '#05030a',
  shadow: 'rgba(0,0,0,0.28)',
  wallFoot: 'rgba(0,0,0,0.35)',
  signBox: OL,
  signBg: '#2a2236',
  signLabel: '#ffe9a8',
  signKind: '#8be9fd',
  gauge: '#8a8399',
};

export interface WorldArt {
  width: number;
  height: number;
  /** grass only */
  terrain: BufferPainter;
  /** grass, paths and offices (no trees or bushes) */
  ground: BufferPainter;
  /** everything */
  full: BufferPainter;
}

export function worldSize(w: WorldLayout): { width: number; height: number } {
  return { width: w.cols * TS, height: GY + w.rows * TS };
}

function floorPattern(g: BufferPainter, kind: FloorKind, x0: number, y0: number, w: number, h: number): void {
  const x1 = x0 + w, y1 = y0 + h;
  if (kind === 'parquet') {
    for (let r = 0, y = y0; y < y1; r++, y += 4) {
      for (let x = x0 - (r % 2) * 8; x < x1; x += 16) { g.rect(x, y, 16, 4, (((x - x0 + 16) >> 4) + r) % 3 === 0 ? '#ad7f55' : '#b98a5e'); g.rect(x, y, 1, 4, '#8f6542'); }
      g.rect(x0, y + 3, w, 1, '#9c7049');
    }
  } else if (kind === 'carpet') {
    g.rect(x0, y0, w, h, '#45557a');
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if ((x * 3 + y * 5) % 7 === 0) g.px(x, y, '#52648c');
  } else if (kind === 'server') {
    g.rect(x0, y0, w, h, '#2b3038');
    for (let x = x0; x < x1; x += 8) g.rect(x, y0, 1, h, '#232830');
    for (let y = y0; y < y1; y += 8) g.rect(x0, y, w, 1, '#232830');
  } else {
    g.rect(x0, y0, w, h, '#cfd6dd');
    for (let x = x0; x < x1; x += 10) g.rect(x, y0, 1, h, '#bcc4cc');
    for (let y = y0; y < y1; y += 10) g.rect(x0, y, w, 1, '#bcc4cc');
  }
}

function drawWall(g: BufferPainter, o: OfficeLayout): void {
  g.rect(o.x, o.y, o.w, 16, o.wall);
  if (o.floor === 'parquet') {
    g.rect(o.x, o.y + 11, o.w, 4, '#cdb894');
    for (const rx of o.windows) {
      const wx = o.x + rx;
      g.rect(wx, o.y + 2, 22, 10, '#8a6a48'); g.rect(wx + 1, o.y + 3, 20, 8, '#9ad7ff');
      g.rect(wx + 10, o.y + 3, 1, 8, '#8a6a48'); g.rect(wx + 4, o.y + 5, 4, 1, '#ffffff'); g.rect(wx + 3, o.y + 6, 6, 1, '#ffffff');
    }
  } else if (o.floor === 'carpet') {
    if (o.poster != null) { const px = o.x + o.poster; g.rect(px, o.y + 3, 12, 9, OL); g.rect(px + 1, o.y + 4, 10, 7, '#e5533d'); g.rect(px + 3, o.y + 6, 6, 3, '#ffd23f'); }
  } else if (o.floor === 'server') {
    g.rect(o.x, o.y + 12, o.w, 2, '#2a2f38'); for (let x = o.x + 4; x < o.x + o.w; x += 9) g.rect(x, o.y + 12, 3, 2, '#e5533d');
  } else {
    g.rect(o.x, o.y + 13, o.w, 1, '#58e1f0');
    if (o.poster != null) { const px = o.x + o.poster; g.rect(px, o.y + 3, 9, 8, '#f2c14e'); g.rect(px + 4, o.y + 4, 1, 4, OL); g.rect(px + 4, o.y + 9, 1, 1, OL); }
  }
  g.rect(o.x, o.y + 15, o.w, 1, PAL.wallFoot);
  drawSign(g, o);
}

/** Office sign: label in 5×7, kind in 4×6, in a box that always fits before the door. */
export function drawSign(g: BufferPainter, o: OfficeLayout): void {
  const sp = signParts(o.label, o.kind);
  const lw = sp.width + 6;
  g.rect(o.x + 5, o.y + 2, lw, 11, PAL.signBox); g.rect(o.x + 6, o.y + 3, lw - 2, 9, PAL.signBg);
  g.text(sp.label, o.x + 8, o.y + 4, PAL.signLabel, 1, FONT_5x7);
  g.text('· ' + sp.kind, o.x + 8 + measure(sp.label, FONT_5x7) + 4, o.y + 5, PAL.signKind, 1, FONT_4x6);
}

function drawTree(g: BufferPainter, art: Art, tr: { x: number; y: number; kind: number }, season: string, S: SeasonPalette): void {
  g.rect(tr.x + 3, tr.y + 16, 9, 2, 'rgba(0,0,0,0.25)');
  if (art.draw(g, `tree.${tr.kind}.${season}`, tr.x, tr.y)) return;
  g.rect(tr.x + 5, tr.y + 10, 4, 7, '#6b4329'); g.rect(tr.x + 2, tr.y, 10, 11, S.c);
}

/** Paints the whole static world. */
export function paintWorld(w: WorldLayout, art: Art): WorldArt {
  const { width: W, height: H } = worldSize(w);
  const S = SEASONS[w.season] ?? SEASONS.verano!;
  const seedN = hashStr(w.seed);
  const terrain = new BufferPainter(W, H), g = new BufferPainter(W, H);
  const cols = w.cols, rows = w.rows;
  for (const p of [terrain]) {
    p.rect(0, 0, W, H, '#14111b');
    p.rect(0, GY, W, H - GY, S.g);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const h = hash(seedN + r * 977 + c * 131);
      for (let k = 0; k < 4; k++) p.px(c * TS + ((h >>> (k * 3)) % 8), GY + r * TS + ((h >>> (k * 3 + 12)) % 8), k % 2 ? S.d : S.l);
      if (h % 9 === 0) {
        const fc = S.fl[(h >>> 5) % S.fl.length]!;
        p.px(c * TS + ((h >>> 8) % 7), GY + r * TS + ((h >>> 11) % 7), fc); p.px(c * TS + ((h >>> 14) % 7), GY + r * TS + ((h >>> 17) % 7), fc);
      }
    }
  }
  g.data.set(terrain.data);
  const pathSet = new Set(w.path);
  const isP = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && pathSet.has(r * cols + c);
  const plazaT = new Set<number>();
  if (w.plazaOk) for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) plazaT.add((w.plaza[1] + dr) * cols + w.plaza[0] + dc);
  const winter = w.season === 'invierno';
  for (const k of w.path) {
    const c = k % cols, r = (k / cols) | 0, x = c * TS, y = GY + r * TS, h = hash(k * 31 + seedN);
    if (plazaT.has(k)) { g.rect(x, y, 8, 8, '#b9b2a6'); g.rect(x, y, 8, 1, '#a39c90'); g.rect(x, y, 1, 8, '#a39c90'); g.px(x + 3 + (h % 3), y + 3, '#d6d0c4'); continue; }
    g.rect(x, y, 8, 8, winter ? '#b8b0a2' : '#c8b48a');
    if (!isP(c, r - 1)) g.rect(x, y, 8, 1, '#a8946a');
    if (!isP(c, r + 1)) g.rect(x, y + 7, 8, 1, '#a8946a');
    if (!isP(c - 1, r)) g.rect(x, y, 1, 8, '#a8946a');
    if (!isP(c + 1, r)) g.rect(x + 7, y, 1, 8, '#a8946a');
    g.px(x + 1 + (h % 5), y + 2 + ((h >>> 4) % 4), '#b5a078'); g.px(x + 2 + ((h >>> 7) % 4), y + 1 + ((h >>> 10) % 5), '#d8c8a0');
  }
  w.offices.forEach((o, oi) => {
    const tiles = o.tiles;
    if (!tiles.length) return;
    const masks = tiles.map(([c, r]) => edgeMask(w.own, c, r, oi));
    for (const [i, [c, r]] of tiles.entries()) {
      const x = c * TS, y = GY + r * TS, m = masks[i]!;
      if (m & SB) g.rect(x + 2, y + 8, 8, 3, PAL.shadow);
      if (m & EB) g.rect(x + 8, y + 3, 2, 8, PAL.shadow);
    }
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const [c, r] of tiles) { x0 = Math.min(x0, c * TS); y0 = Math.min(y0, GY + r * TS); x1 = Math.max(x1, c * TS + TS); y1 = Math.max(y1, GY + r * TS + TS); }
    // floor pattern clipped to the office tiles
    const fp = new BufferPainter(x1 - x0, y1 - y0);
    floorPattern(fp, o.floor, 0, 0, x1 - x0, y1 - y0);
    for (const [c, r] of tiles) blit(fp, c * TS - x0, GY + r * TS - y0, g, c * TS, GY + r * TS, TS, TS);
    drawWall(g, o);
    const hall = (c: number, r: number): boolean => c >= o.tx && c < o.tx + o.tw && r >= o.ty && r < o.ty + o.th;
    for (const [i, [c, r]] of tiles.entries()) {
      const x = c * TS, y = GY + r * TS, m = masks[i]!;
      // low wall on wing tiles whose back is open (autotile: N edge)
      if (!hall(c, r) && m & NB) { g.rect(x, y, 8, 7, o.wall); g.rect(x, y + 6, 8, 1, PAL.wallFoot); }
      if (o.floor === 'lab' && m & SB) for (let rr = 5; rr < 8; rr++) for (let xx = 0; xx < 8; xx++) g.px(x + xx, y + rr, ((x + xx + rr) >> 2) & 1 ? '#f2c14e' : OL);
    }
    for (const [i, [c, r]] of tiles.entries()) {
      const x = c * TS, y = GY + r * TS, m = masks[i]!;
      if (m & NB) g.rect(x, y, 8, 1, PAL.outline);
      if (m & SB) g.rect(x, y + 7, 8, 1, PAL.outline);
      if (m & WB) g.rect(x, y, 1, 8, PAL.outline);
      if (m & EB) g.rect(x + 7, y, 1, 8, PAL.outline);
    }
    for (let i = 0; i < o.racks; i++) drawRack(g, art, o.x + 6 + i * 16, o.y + 20);
    const gx = o.x + o.w - 24;
    g.rect(gx + 1, o.y + 57, 9, 2, '#3a3346');
    g.rect(gx - 2, o.y + 81, 19, 3, '#3a3346'); g.rect(gx - 2, o.y + 81, 19, 1, '#4d4459');
    g.text('CARGA', gx - 3, o.y + 19, PAL.gauge);
  });
  const ground = new BufferPainter(W, H);
  ground.data.set(g.data);
  for (const b of w.bushes) {
    if (!art.draw(g, `bush.${w.season}`, b.x, b.y)) { g.rect(b.x, b.y + 1, 8, 4, S.cd); g.rect(b.x + 1, b.y, 6, 4, S.c); }
    g.rect(b.x + 1, b.y + 5, 6, 1, 'rgba(0,0,0,0.25)');
  }
  for (const tr of [...w.trees].sort((a, b) => a.y - b.y)) drawTree(g, art, tr, w.season, S);
  return { width: W, height: H, terrain, ground, full: g };
}

/** Copies a w×h block between buffers (opaque pixels only). */
export function blit(src: BufferPainter, sx: number, sy: number, dst: BufferPainter, dx: number, dy: number, w: number, h: number): void {
  const sd = src.data, dd = dst.data;
  for (let y = 0; y < h; y++) {
    const syy = sy + y, dyy = dy + y;
    if (syy < 0 || dyy < 0 || syy >= src.height || dyy >= dst.height) continue;
    for (let x = 0; x < w; x++) {
      const sxx = sx + x, dxx = dx + x;
      if (sxx < 0 || dxx < 0 || sxx >= src.width || dxx >= dst.width) continue;
      const si = (syy * src.width + sxx) * 4;
      if (sd[si + 3] === 0) continue;
      const di = (dyy * dst.width + dxx) * 4;
      dd[di] = sd[si]!; dd[di + 1] = sd[si + 1]!; dd[di + 2] = sd[si + 2]!; dd[di + 3] = sd[si + 3]!;
    }
  }
  dst.dirty = true;
}

/** Copies a rect verbatim (same coordinates in both buffers of equal size). */
export function copyRect(src: BufferPainter, dst: BufferPainter, x: number, y: number, w: number, h: number): void {
  const W = src.width;
  const x0 = Math.max(0, x), x1 = Math.min(W, x + w), y0 = Math.max(0, y), y1 = Math.min(src.height, y + h);
  if (x1 <= x0) return;
  for (let yy = y0; yy < y1; yy++) dst.data.set(src.data.subarray((yy * W + x0) * 4, (yy * W + x1) * 4), (yy * W + x0) * 4);
  dst.dirty = true;
}

/**
 * Construction frame into `out`: the new world, with what is not built yet shown as terrain, what is
 * being demolished shown from the previous world's art until its time, and a white flash on fresh
 * tiles. `prev` is the art of the previous layout (any size; only overlapping rects copy).
 */
export function paintConstruction(wa: WorldArt, prev: WorldArt | null, w: WorldLayout, tb: number, out: BufferPainter): void {
  out.data.set(wa.full.data);
  const rv = w.build.reveal, dm = w.build.demolish;
  // pending tiles show terrain; pending trees/bushes show the ground (they may overlap built tiles)
  for (const r of rv) if (r.time > tb) copyRect(r.kind === 'office' || r.kind === 'path' ? wa.terrain : wa.ground, out, r.x, r.y, r.w, r.h);
  if (prev) for (const r of dm) if (r.time > tb) copyRectFrom(prev.full, out, r.x, r.y, r.w, r.h);
  // trees and bushes overlap each other: restore the revealed ones a pending neighbour may have hidden
  for (const r of rv) if (r.time <= tb && r.kind !== 'office' && r.kind !== 'path') copyRect(wa.full, out, r.x, r.y, r.w, r.h);
  for (const r of rv) {
    const a = tb - r.time;
    if (a < 0 || a >= 0.15) continue;
    const pa = out.alpha(1 - a / 0.15);
    out.rect(r.x, r.y, r.w, 1, '#ffffff'); out.rect(r.x, r.y + r.h - 1, r.w, 1, '#ffffff');
    out.rect(r.x, r.y, 1, r.h, '#ffffff'); out.rect(r.x + r.w - 1, r.y, 1, r.h, '#ffffff');
    out.alpha(pa);
  }
  for (const r of dm) {
    const a = r.time - tb;
    if (a < 0 || a >= 0.12 || r.kind !== 'office') continue;
    const pa = out.alpha(0.7);
    out.rect(r.x, r.y, r.w, r.h, '#ffd23f');
    out.alpha(pa);
  }
  out.dirty = true;
}

/** Copies a rect from a buffer of any size into `dst` at the same coordinates (clipped to both). */
export function copyRectFrom(src: BufferPainter, dst: BufferPainter, x: number, y: number, w: number, h: number): void {
  const x0 = Math.max(0, x), x1 = Math.min(src.width, dst.width, x + w), y0 = Math.max(0, y), y1 = Math.min(src.height, dst.height, y + h);
  if (x1 <= x0) return;
  for (let yy = y0; yy < y1; yy++) dst.data.set(src.data.subarray((yy * src.width + x0) * 4, (yy * src.width + x1) * 4), (yy * dst.width + x0) * 4);
  dst.dirty = true;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
