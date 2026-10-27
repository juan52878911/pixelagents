import { parseColor } from './px.js';

/** Procedural drawing API for props (fire, ice, thermometers, gags), same calls as the prototype. */
export interface Painter {
  px(x: number, y: number, color: string): void;
  rect(x: number, y: number, w: number, h: number, color: string): void;
  /** rows of palette keys ('.' or unknown key = transparent). */
  sprite(rows: readonly string[], x: number, y: number, pal: Record<string, string>, flip?: boolean): void;
  text(s: string, x: number, y: number, color: string, scale?: number): void;
  /** Global alpha (0..1) for the following calls. Returns the previous value. */
  alpha(a: number): number;
}

/** 3×5 pixel font of the prototype. Each glyph: 15 bits, row-major. */
export const FONT: Record<string, string> = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010', '8': '111101111101111',
  '9': '111101111001110', $: '011110010011110', '%': '101001010100101', '.': '000000000000010', ':': '000010000010000',
  '-': '000000111000000', '@': '010101111100011', '/': '001001010100100', '!': '010010010000010', '?': '110001010000010',
  ' ': '000000000000000', '·': '000000010000000', '+': '000010111010000', _: '000000000000111',
};

export function textWidth(s: string, scale = 1): number { return (s.length * 4 - 1) * scale; }

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

  text(s: string, x: number, y: number, color: string, scale = 1): void {
    const c = parseColor(color);
    s = s.toUpperCase();
    x = Math.round(x); y = Math.round(y);
    for (let i = 0; i < s.length; i++) {
      const g = FONT[s[i]!];
      if (!g) continue;
      for (let k = 0; k < 15; k++) {
        if (g[k] !== '1') continue;
        const gx = x + (i * 4 + (k % 3)) * scale, gy = y + Math.floor(k / 3) * scale;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) this.put(gx + dx, gy + dy, c[0], c[1], c[2], c[3]);
      }
    }
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
