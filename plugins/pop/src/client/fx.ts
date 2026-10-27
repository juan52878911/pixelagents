import { OL, hash, type Painter } from './painter.js';

/**
 * Procedural, truly animated effects (port of the prototype's drawFire, drawSmoke, frozen glass,
 * drawBeam, drawPoof, drawThermo and drawMonitor). Static art lives in assets/*.px.json.
 * Each effect is a plain function with the prototype's signature, plus a normalized entry in `FX`.
 */

/** Flames rising from (x, y), `w` wide and up to `h` tall, with ember sparks. */
export function fire(g: Painter, x: number, y: number, w: number, h: number, t: number, seed: number): void {
  for (let c = 0; c < w; c++) {
    const n = (Math.sin(c * 1.3 + t * 11 + seed) + Math.sin(c * 0.7 - t * 7.1 + seed * 2) + 2) / 4;
    const env = 1 - Math.abs(c - (w - 1) / 2) / (w * 0.75);
    const ht = Math.max(1, Math.round(h * (0.35 + 0.65 * n) * env));
    for (let r = 0; r < ht; r++) {
      const f = r / ht;
      g.rect(x + c, y - r, 1, 1, f < 0.3 ? '#c4302b' : f < 0.6 ? '#f0802a' : f < 0.88 ? '#ffd23f' : '#fff6c9');
    }
  }
  for (let i = 0; i < 4; i++) {
    const p = (t * 1.6 + i * 0.27 + seed * 0.1) % 1;
    g.rect(x + Math.round(w / 2 + (Math.sin(t * 3 + i * 2) * w) / 2.5), y - h - Math.round(p * 10), 1, 1, p < 0.5 ? '#ffd23f' : '#f0802a');
  }
}

/** Smoke column rising from (cx, top), fading as it climbs. */
export function smoke(g: Painter, cx: number, top: number, t: number): void {
  for (let i = 0; i < 6; i++) {
    const p = (t * 0.5 + i / 6) % 1;
    g.alpha(0.6 * (1 - p));
    const s = p < 0.5 ? 2 : 3;
    g.rect(cx + Math.round(Math.sin(t * 1.5 + i) * 3 + p * 4), top - Math.round(p * 18), s, s, '#6b6f78');
  }
  g.alpha(1);
}

/**
 * Ice block around a character whose top-left is (cx, cy), inside a pod whose origin is (px, py):
 * translucent tint, white highlights and twinkling frost sparkles.
 */
export function ice(g: Painter, px: number, py: number, cx: number, cy: number, t: number, seed: number): void {
  g.alpha(0.3); g.rect(cx - 1, cy - 3, 12, 14, '#9fdcff'); g.alpha(1);
  g.rect(cx - 1, cy - 3, 12, 1, '#ffffff'); g.rect(cx - 1, cy - 3, 1, 14, '#ffffff');
  g.rect(cx + 1, cy - 1, 1, 3, '#ffffff'); g.rect(cx + 2, cy - 2, 1, 1, '#ffffff');
  for (let i = 0; i < 3; i++) {
    const k = Math.floor(t * 2 + i * 3);
    if (hash(k + seed) % 3 === 0) {
      const sx = px + 2 + (hash(k * 7 + i) % 18), sy = py + 2 + (hash(k * 13 + i) % 20);
      g.rect(sx, sy, 1, 1, '#ffffff'); g.rect(sx - 1, sy, 1, 1, 'rgba(255,255,255,0.5)'); g.rect(sx + 1, sy, 1, 1, 'rgba(255,255,255,0.5)');
      g.rect(sx, sy - 1, 1, 1, 'rgba(255,255,255,0.5)'); g.rect(sx, sy + 1, 1, 1, 'rgba(255,255,255,0.5)');
    }
  }
}

/** Remap a character palette to the four blues of frozen glass (by luminance). */
export function icePalette(p: Readonly<Record<string, string>>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of Object.keys(p)) {
    const c = p[k];
    if (!c || c[0] !== '#') continue;
    const n = parseInt(c.slice(1), 16);
    const l = (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
    o[k] = l < 0.25 ? '#16304d' : l < 0.45 ? '#2f5f8f' : l < 0.7 ? '#5f9fd0' : '#bfe6ff';
  }
  return o;
}

/** Teleport beam centered on cx between `top` and `bottom`; p (0..1) is how far it has descended. */
export function beam(g: Painter, cx: number, top: number, bottom: number, p: number, t: number): void {
  const b = top + Math.round((bottom - top) * Math.min(1, p));
  g.alpha(0.28); g.rect(cx - 5, top, 10, b - top, '#8ff3ff');
  g.alpha(0.55); g.rect(cx - 2, top, 4, b - top, '#e6fdff');
  g.alpha(1);
  for (let y = top + (Math.floor(t * 30) % 4); y < b; y += 4) g.rect(cx - 4, y, 8, 1, 'rgba(230,253,255,0.5)');
  for (let i = 0; i < 5; i++) {
    const h = hash(i * 17 + Math.floor(t * 12));
    g.rect(cx - 6 + (h % 12), top + ((h >>> 4) % Math.max(1, b - top)), 1, 1, '#ffffff');
  }
}

/** "Puf" smoke burst at (cx, cy); p 0..1. */
export function poof(g: Painter, cx: number, cy: number, p: number): void {
  g.alpha(Math.max(0, 1 - p));
  if (p < 0.4) g.rect(cx - 1, cy - 1, 3, 3, '#ffffff');
  for (let k = 0; k < 10; k++) {
    const a = k * 0.628, r = 1 + p * 6;
    g.rect(cx + Math.round(Math.cos(a) * r), cy + Math.round(Math.sin(a) * r * 0.7), k % 3 ? 1 : 2, 1, k % 2 ? '#ffffff' : '#c9c3d6');
  }
  g.alpha(1);
}

/** Vertical thermometer (5×31) at (x, y) filled to `lvl` percent; green < 50, amber < 80, red above. */
export function thermo(g: Painter, x: number, y: number, lvl: number): void {
  const c = lvl < 50 ? '#4cc38a' : lvl < 80 ? '#f2c14e' : '#e5533d';
  g.rect(x + 1, y, 3, 1, OL); g.rect(x, y + 1, 1, 24, OL); g.rect(x + 4, y + 1, 1, 24, OL);
  g.rect(x + 1, y + 1, 3, 24, '#e9f2f7');
  const fh = Math.max(1, Math.round((23 * lvl) / 100));
  g.rect(x + 1, y + 25 - fh, 3, fh, c); g.rect(x + 1, y + 25 - fh, 1, fh, 'rgba(255,255,255,0.35)');
  g.rect(x - 1, y + 25, 7, 5, OL); g.rect(x, y + 24, 5, 1, OL); g.rect(x, y + 30, 5, 1, OL);
  g.rect(x, y + 25, 5, 5, c); g.rect(x + 1, y + 26, 1, 1, 'rgba(255,255,255,0.6)');
  for (let i = 0; i < 4; i++) g.rect(x + 5, y + 4 + i * 6, 2, 1, '#8a8399');
}

export type MonitorState = 'work' | 'think' | 'wait' | 'fire' | 'sleep' | 'off';

/** Monitor (10×9) with its animated screen: code lines, spinner, alert, flicker or static. */
export function monitor(g: Painter, mx: number, my: number, st: MonitorState, t: number, seed: number): void {
  g.rect(mx, my, 10, 7, '#2a2733'); g.rect(mx + 4, my + 7, 2, 1, '#2a2733'); g.rect(mx + 3, my + 8, 4, 1, '#3b3846');
  const sx = mx + 1, sy = my + 1;
  if (st === 'sleep' || st === 'off') {
    g.rect(sx, sy, 8, 5, '#100e16');
    const k = Math.floor(t * 2 + seed);
    g.rect(sx + (hash(k) % 8), sy + (hash(k + 99) % 5), 1, 1, '#5b5470');
  } else if (st === 'wait') {
    g.rect(sx, sy, 8, 5, '#3a2f0c');
    if (Math.floor(t * 3) % 2) { g.rect(sx + 3, sy, 1, 3, '#ffd23f'); g.rect(sx + 3, sy + 4, 1, 1, '#ffd23f'); }
  } else if (st === 'fire') {
    g.rect(sx, sy, 8, 5, Math.floor(t * 6) % 2 ? '#5a0f0f' : '#2a0808');
    g.rect(sx + 2, sy + 1, 1, 3, '#ff5a3c'); g.rect(sx + 5, sy + 1, 1, 3, '#ff5a3c');
  } else {
    g.rect(sx, sy, 8, 5, '#0f1b26');
    const cols = ['#7ee787', '#79c0ff', '#ffa657', '#d2a8ff'];
    const scroll = st === 'think' ? 0 : Math.floor(t * 3);
    for (let i = 0; i < 3; i++) {
      const h = hash(seed * 31 + i + scroll);
      g.rect(sx + 1 + (h % 2), sy + i * 2, 2 + ((h >>> 3) % 5), 1, cols[(h >>> 7) % 4] ?? '#7ee787');
    }
    if (st === 'think' && Math.floor(t * 2) % 2) g.rect(sx + 6, sy + 4, 1, 1, '#ffffff');
  }
}

/** Normalized entry: draws at origin (x, y) with progress p (0..1) at time t; `box` = [x0, y0, x1, y1] relative to (x, y). */
export interface Fx {
  name: string;
  box: readonly [number, number, number, number];
  draw(g: Painter, x: number, y: number, p: number, t: number): void;
}

const MONITOR_STATES: readonly MonitorState[] = ['work', 'think', 'wait', 'fire', 'sleep'];

export const FX: Record<string, Fx> = {
  fire: { name: 'Fuego', box: [0, -24, 20, 1], draw: (g, x, y, p, t) => fire(g, x, y, 20, Math.max(1, Math.round(13 * p)), t, 0) },
  smoke: { name: 'Humo', box: [-3, -18, 10, 3], draw: (g, x, y, _p, t) => smoke(g, x, y, t) },
  ice: { name: 'Hielo', box: [0, 0, 22, 24], draw: (g, x, y, _p, t) => ice(g, x, y, x + 2, y + 10, t, 0) },
  beam: { name: 'Haz de teletransporte', box: [-6, -26, 6, 25], draw: (g, x, y, p, t) => beam(g, x, y - 26, y + 25, p, t) },
  poof: { name: 'Puf', box: [-8, -5, 9, 6], draw: (g, x, y, p) => poof(g, x, y, p) },
  thermo: { name: 'Termómetro', box: [-1, 0, 7, 31], draw: (g, x, y, p) => thermo(g, x, y, Math.round(p * 100)) },
  monitor: {
    name: 'Monitor', box: [0, 0, 10, 9],
    draw: (g, x, y, p, t) => monitor(g, x, y, MONITOR_STATES[Math.min(MONITOR_STATES.length - 1, Math.floor(p * MONITOR_STATES.length))] ?? 'work', t, 3),
  },
};
