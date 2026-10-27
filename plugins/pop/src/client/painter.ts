/**
 * Painter: the minimal drawing surface gags and effects need. Same primitives as the prototype
 * (`R`, `spr`, `txt`, `globalAlpha`) so the web engine can implement it over Pixi in a few lines.
 * Coordinates are integers in the low-res world; colors are "#rrggbb" or "rgba(r,g,b,a)".
 */
export interface Painter {
  /** One pixel. */
  px(x: number, y: number, color: string): void;
  /** Filled rectangle. */
  rect(x: number, y: number, w: number, h: number, color: string): void;
  /** Rows of equal length; '.' (or any key missing from `palette`) is transparent. `flip` mirrors horizontally. */
  sprite(rows: readonly string[], x: number, y: number, palette: Readonly<Record<string, string>>, flip?: boolean): void;
  /** 3x5 font text (uppercase; glyphs advance 4 px × scale). */
  text(s: string, x: number, y: number, color: string, scale?: number): void;
  /** Global alpha for what is drawn next, 0..1. Callers restore it to 1. */
  alpha(a: number): void;
}

/** Outline color shared by all pop art. */
export const OL = '#1a1423';

/** Deterministic integer hash, identical to the prototype's. */
export function hash(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return n >>> 0;
}

/** Clamp v to [a, b]. */
export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

/** Shared palette of the pop library. */
export const POP_C = {
  gold: '#f5c542', goldL: '#fff1a8', goldD: '#b8860b',
  red: '#e5533d', redL: '#ff9d8a', redD: '#a8322a',
  orange: '#f0802a', yellow: '#ffd23f', cream: '#fff6c9',
  green: '#4cc38a', greenL: '#8ee6b4', greenD: '#2e8a5e', lime: '#7ee787',
  blue: '#4a90e2', sky: '#79c0ff', cyan: '#5ad1e6', cyanL: '#9be8f5', cyanD: '#3fb8d8',
  purple: '#d2a8ff', magenta: '#d64fa0', pink: '#ffb3d9',
  white: '#e9f2f7', grey: '#8f96a3', greyD: '#5b5470', slate: '#3b3346', dark: '#100e16',
  wood: '#a8744c', woodL: '#c9a06a', woodD: '#6b4329', skin: '#f5e6c8',
} as const;
