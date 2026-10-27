import type { OverlaySprite, PxFile, PxSprite } from '@pixelagents/protocol';
import type { Texture } from 'pixi.js';

export type Rgba = [number, number, number, number];
export type View = 'front' | 'side' | 'back';

const colorCache = new Map<string, Rgba>();

/** "#rgb" | "#rrggbb" | "#rrggbbaa" | "rgba(r,g,b,a)" | "rgb(r,g,b)" → [r,g,b,a(0..255)]. */
export function parseColor(c: string): Rgba {
  const hit = colorCache.get(c);
  if (hit) return hit;
  let out: Rgba;
  const s = c.trim();
  if (s[0] === '#') {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    if (!/^[0-9a-f]+$/i.test(h) || (h.length !== 6 && h.length !== 8)) throw new Error(`px: invalid color "${c}"`);
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    out = [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
  } else {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
    if (!m) throw new Error(`px: invalid color "${c}"`);
    out = [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 255 : Math.round(+m[4] * 255)];
  }
  colorCache.set(c, out);
  return out;
}

/** Pure: one frame of a sprite → RGBA bytes (w*h*4). Throws on malformed rows or missing palette keys. */
export function compileFrame(sprite: PxSprite, frame: number, paletteOverride?: Record<string, string>): Uint8ClampedArray {
  const rows = sprite.frames[frame];
  if (!rows) throw new Error(`px: sprite "${sprite.name}" has no frame ${frame}`);
  const { w, h } = sprite;
  if (rows.length !== h) throw new Error(`px: sprite "${sprite.name}" frame ${frame} has ${rows.length} rows, expected ${h}`);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    if (row.length !== w) throw new Error(`px: sprite "${sprite.name}" frame ${frame} row ${y} is ${row.length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      if (ch === '.') continue;
      const col = paletteOverride?.[ch] ?? sprite.palette[ch];
      if (col === undefined) throw new Error(`px: sprite "${sprite.name}" frame ${frame} uses palette key "${ch}" which is not defined`);
      const [r, g, b, a] = parseColor(col);
      const i = (y * w + x) * 4;
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
    }
  }
  return out;
}

export interface Compiled { data: Uint8ClampedArray; w: number; h: number; }

/**
 * Composites an accessory overlay over a compiled frame. Overlay coordinates are relative to the
 * sprite's top-left and may be negative (caps), so the result is padded by `pad` px on every side.
 */
export function compositeOverlay(
  base: Uint8ClampedArray, w: number, h: number,
  overlay: OverlaySprite, view: View, palette: Record<string, string>, pad = 2,
): Compiled {
  const W = w + pad * 2, H = h + pad * 2;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y++) {
    out.set(base.subarray(y * w * 4, (y + 1) * w * 4), ((y + pad) * W + pad) * 4);
  }
  for (const [x, y, key] of overlay.views[view] ?? []) {
    const col = palette[key];
    if (col === undefined) throw new Error(`px: overlay "${overlay.name}" uses palette key "${key}" which is not defined`);
    const px = x + pad, py = y + pad;
    if (px < 0 || py < 0 || px >= W || py >= H) continue;
    const [r, g, b, a] = parseColor(col);
    const i = (py * W + px) * 4;
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
  }
  return { data: out, w: W, h: H };
}

export interface AtlasItem { key: string; w: number; h: number; data: Uint8ClampedArray; }
export interface AtlasRect { x: number; y: number; w: number; h: number; }
export interface Atlas { width: number; height: number; data: Uint8ClampedArray; rects: Map<string, AtlasRect>; }

/** Shelf-packs items into one RGBA atlas (power-of-two width, 1px gutter). Pure. */
export function packAtlas(items: AtlasItem[], maxWidth = 2048): Atlas {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const rects = new Map<string, AtlasRect>();
  let width = 16;
  const total = sorted.reduce((s, i) => s + (i.w + 1) * (i.h + 1), 0);
  while (width * width < total * 1.3 && width < maxWidth) width *= 2;
  for (const it of sorted) {
    if (it.w > maxWidth) throw new Error(`px: atlas item "${it.key}" wider than atlas`);
    while (it.w > width) width *= 2;
  }
  let x = 0, y = 0, rowH = 0;
  for (const it of sorted) {
    if (x + it.w > width) { x = 0; y += rowH + 1; rowH = 0; }
    rects.set(it.key, { x, y, w: it.w, h: it.h });
    x += it.w + 1;
    rowH = Math.max(rowH, it.h);
  }
  const height = Math.max(1, y + rowH);
  const data = new Uint8ClampedArray(width * height * 4);
  for (const it of sorted) {
    const r = rects.get(it.key)!;
    for (let row = 0; row < it.h; row++) data.set(it.data.subarray(row * it.w * 4, (row + 1) * it.w * 4), ((r.y + row) * width + r.x) * 4);
  }
  return { width, height, data, rects };
}

/** A compiled, GPU-ready sprite variant. */
export interface SpriteSheet {
  name: string;
  w: number;
  h: number;
  anchor: [number, number];
  fps: number;
  frames: Texture[];
  tags: Record<string, [number, number]>;
  meta: Record<string, unknown>;
  /** Per-frame durations in ms (Aseprite); undefined → 1000/fps. */
  durations?: number[];
}

/** Current frame index for a sheet at time `t` (ms), looping inside an optional tag. Allocation-free. */
export function frameAt(sheet: Pick<SpriteSheet, 'fps' | 'frames' | 'tags' | 'durations'>, t: number, tag?: string): number {
  const range = tag ? sheet.tags[tag] : undefined;
  const a = range ? range[0] : 0;
  const b = range ? range[1] : sheet.frames.length - 1;
  const n = b - a + 1;
  if (n <= 1) return a;
  if (sheet.durations) {
    let total = 0;
    for (let i = a; i <= b; i++) total += sheet.durations[i] ?? 100;
    let m = t % total;
    for (let i = a; i <= b; i++) { m -= sheet.durations[i] ?? 100; if (m < 0) return i; }
    return b;
  }
  if (!sheet.fps) return a;
  return a + (Math.floor((t * sheet.fps) / 1000) % n);
}

