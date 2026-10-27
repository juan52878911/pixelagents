/**
 * Static world art (port of drawWorld): grass, paths and plaza, office floors/walls/signs, racks,
 * thermometer stands, bushes and trees, into two buffers — `terrain` (grass only) and `full`.
 * During the build animation the visible world is terrain + the revealed rects of `full`.
 */
import { BufferPainter } from '../engine/painter.js';
import { SEASONS, type SeasonPalette } from '../world/seasons.js';
import { GY, TS, type FloorKind, type OfficeLayout, type WorldLayout } from '../world/types.js';
import type { Art } from './art.js';
import { OL } from './chars.js';
import { drawRack, hash, txtW } from './props.js';

export interface WorldArt {
  width: number;
  height: number;
  terrain: BufferPainter;
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
  g.rect(o.x, o.y + 15, o.w, 1, 'rgba(0,0,0,0.35)');
  const name = o.label.toUpperCase(), kind = ' · ' + o.kind.toUpperCase();
  const lw = txtW(name + kind) + 6;
  g.rect(o.x + 5, o.y + 3, lw, 9, OL); g.rect(o.x + 6, o.y + 4, lw - 2, 7, '#2a2236');
  g.text(name, o.x + 8, o.y + 5, '#ffe9a8');
  g.text(kind, o.x + 8 + txtW(name) + 1, o.y + 5, '#8be9fd');
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
    const mine = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && w.own[r]![c] === oi;
    const tiles: [number, number][] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (w.own[r]![c] === oi) tiles.push([c, r]);
    if (!tiles.length) return;
    for (const [c, r] of tiles) {
      const x = c * TS, y = GY + r * TS;
      if (!mine(c, r + 1)) g.rect(x + 2, y + 8, 8, 3, 'rgba(0,0,0,0.28)');
      if (!mine(c + 1, r)) g.rect(x + 8, y + 3, 2, 8, 'rgba(0,0,0,0.28)');
    }
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const [c, r] of tiles) { x0 = Math.min(x0, c * TS); y0 = Math.min(y0, GY + r * TS); x1 = Math.max(x1, c * TS + TS); y1 = Math.max(y1, GY + r * TS + TS); }
    // floor pattern clipped to the office tiles
    const fp = new BufferPainter(x1 - x0, y1 - y0);
    floorPattern(fp, o.floor, 0, 0, x1 - x0, y1 - y0);
    for (const [c, r] of tiles) blit(fp, c * TS - x0, GY + r * TS - y0, g, c * TS, GY + r * TS, TS, TS);
    drawWall(g, o);
    for (const [c, r] of tiles) {
      const x = c * TS, y = GY + r * TS;
      const hall = c >= o.tx && c < o.tx + o.tw && r < o.ty + 2 && r >= o.ty;
      if (!hall && !mine(c, r - 1)) { g.rect(x, y, 8, 7, o.wall); g.rect(x, y + 6, 8, 1, 'rgba(0,0,0,0.35)'); }
      if (o.floor === 'lab' && !mine(c, r + 1)) for (let rr = 5; rr < 8; rr++) for (let xx = 0; xx < 8; xx++) g.px(x + xx, y + rr, ((x + xx + rr) >> 2) & 1 ? '#f2c14e' : OL);
    }
    for (const [c, r] of tiles) {
      const x = c * TS, y = GY + r * TS;
      if (!mine(c, r - 1)) g.rect(x, y, 8, 1, '#05030a');
      if (!mine(c, r + 1)) g.rect(x, y + 7, 8, 1, '#05030a');
      if (!mine(c - 1, r)) g.rect(x, y, 1, 8, '#05030a');
      if (!mine(c + 1, r)) g.rect(x + 7, y, 1, 8, '#05030a');
    }
    for (let i = 0; i < o.racks; i++) drawRack(g, art, o.x + 6 + i * 16, o.y + 20);
    const gx = o.x + o.w - 24;
    g.rect(gx + 1, o.y + 57, 9, 2, '#3a3346');
    g.rect(gx - 2, o.y + 81, 19, 3, '#3a3346'); g.rect(gx - 2, o.y + 81, 19, 1, '#4d4459');
    g.text('CARGA', gx - 3, o.y + 19, '#8a8399');
  });
  for (const b of w.bushes) {
    if (!art.draw(g, `bush.${w.season}`, b.x, b.y)) { g.rect(b.x, b.y + 1, 8, 4, S.cd); g.rect(b.x + 1, b.y, 6, 4, S.c); }
    g.rect(b.x + 1, b.y + 5, 6, 1, 'rgba(0,0,0,0.25)');
  }
  for (const tr of [...w.trees].sort((a, b) => a.y - b.y)) drawTree(g, art, tr, w.season, S);
  return { width: W, height: H, terrain, full: g };
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

/** Build animation frame into `out`: terrain, then every revealed item, with a white flash on fresh tiles. */
export function paintConstruction(wa: WorldArt, w: WorldLayout, tb: number, out: BufferPainter): void {
  out.data.set(wa.terrain.data);
  for (const rv of w.build.reveal) {
    if (rv.time > tb) continue;
    copyRect(wa.full, out, rv.x, rv.y, rv.w, rv.h);
    const a = tb - rv.time;
    if (a < 0.15) {
      const pa = out.alpha(1 - a / 0.15);
      out.rect(rv.x, rv.y, rv.w, 1, '#ffffff'); out.rect(rv.x, rv.y + rv.h - 1, rv.w, 1, '#ffffff');
      out.rect(rv.x, rv.y, 1, rv.h, '#ffffff'); out.rect(rv.x + rv.w - 1, rv.y, 1, rv.h, '#ffffff');
      out.alpha(pa);
    }
  }
  out.dirty = true;
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
