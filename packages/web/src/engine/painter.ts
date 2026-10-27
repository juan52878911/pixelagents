import { FONT_3x5, type BitmapFont, drawGlyphs, measure } from './fonts.js';
import { parseColor } from './px.js';

export { FONT, FONT_3x5, FONT_4x6, FONT_5x7, fit, measure, plain, type BitmapFont } from './fonts.js';

/** Procedural drawing API for props (fire, ice, thermometers, gags), same calls as the prototype. */
export interface Painter {
  px(x: number, y: number, color: string): void;
  rect(x: number, y: number, w: number, h: number, color: string): void;
  /** rows of palette keys ('.' or unknown key = transparent). */
  sprite(rows: readonly string[], x: number, y: number, pal: Record<string, string>, flip?: boolean): void;
  /** Bitmap text (uppercase, diacritics stripped); default font 3×5 with 4 px advance. */
  text(s: string, x: number, y: number, color: string, scale?: number, font?: BitmapFont): void;
  /** Global alpha (0..1) for the following calls. Returns the previous value. */
  alpha(a: number): number;
}

/** Width of `s` in the 3×5 font (same as `measure(s, FONT_3x5, scale)`). */
export function textWidth(s: string, scale = 1, font: BitmapFont = FONT_3x5): number { return measure(s, font, scale); }

/** Painter over a premultiplied-free RGBA buffer (source-over blending). Pure; no allocation per call. */
export class BufferPainter implements Painter {
  readonly data: Uint8ClampedArray;
  /** Set by every draw call; the owner uploads and clears it. */
  dirty = false;
  /** Optional clip rectangle [x0, y0, x1, y1) applied to every draw call; null = whole buffer. */
  clipRect: [number, number, number, number] | null = null;
  private a = 1;

  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  clear(): void { this.data.fill(0); this.dirty = true; }
  alpha(a: number): number { const p = this.a; this.a = a < 0 ? 0 : a > 1 ? 1 : a; return p; }

  px(x: number, y: number, color: string): void {
    const c = parseColor(color);
    this.put(x | 0, y | 0, c[0], c[1], c[2], c[3]);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    const c = parseColor(color);
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x) + w), y1 = Math.min(this.height, Math.round(y) + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.put(xx, yy, c[0], c[1], c[2], c[3]);
  }

  sprite(rows: readonly string[], x: number, y: number, pal: Record<string, string>, flip = false): void {
    x = Math.round(x); y = Math.round(y);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!, w = row.length;
      for (let c = 0; c < w; c++) {
        const col = pal[row[c]!];
        if (!col) continue;
        const k = parseColor(col);
        this.put(x + (flip ? w - 1 - c : c), y + r, k[0], k[1], k[2], k[3]);
      }
    }
  }

  text(s: string, x: number, y: number, color: string, scale = 1, font: BitmapFont = FONT_3x5): void {
    const c = parseColor(color);
    drawGlyphs((px, py) => this.put(px, py, c[0], c[1], c[2], c[3]), s, Math.round(x), Math.round(y), font, scale);
  }

  /** Restricts drawing to a rectangle (null clears). Returns the previous clip. */
  clip(r: [number, number, number, number] | null): [number, number, number, number] | null {
    const p = this.clipRect; this.clipRect = r; return p;
  }

  private put(x: number, y: number, r: number, g: number, b: number, a255: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const cr = this.clipRect;
    if (cr && (x < cr[0] || y < cr[1] || x >= cr[2] || y >= cr[3])) return;
    const sa = (a255 / 255) * this.a;
    if (sa <= 0) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    if (sa >= 1) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    else {
      const da = d[i + 3]! / 255;
      const oa = sa + da * (1 - sa);
      d[i] = (r * sa + d[i]! * da * (1 - sa)) / oa;
      d[i + 1] = (g * sa + d[i + 1]! * da * (1 - sa)) / oa;
      d[i + 2] = (b * sa + d[i + 2]! * da * (1 - sa)) / oa;
      d[i + 3] = oa * 255;
    }
    this.dirty = true;
  }
}
