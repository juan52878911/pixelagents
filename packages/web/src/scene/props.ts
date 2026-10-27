/**
 * Props drawn through the Painter: static art comes from assets (prop.*, deco.*, pod.*, bubble.*),
 * animated effects from plugins/pop (fire, smoke, beam, poof, thermo, monitor). Coordinates and
 * timings follow design/prototype/prototype.html.
 */
import { FONT_4x6, measure } from '../engine/fonts.js';
import type { BufferPainter, Painter } from '../engine/painter.js';
import { textWidth } from '../engine/painter.js';
import { beam, fire, monitor, poof, smoke, thermo, hash, type MonitorState } from '../../../../plugins/pop/src/client/index.js';
import type { Art } from './art.js';
import { OL, drawChar, icePal, type Look } from './chars.js';

export { beam, fire, monitor, poof, smoke, thermo, hash };
export const txtW = (s: string): number => textWidth(s);

export function bubble(g: Painter, x: number, y: number, w: number, h: number, fill: string): void {
  g.rect(x + 1, y, w - 2, 1, OL); g.rect(x + 1, y + h - 1, w - 2, 1, OL);
  g.rect(x, y + 1, 1, h - 2, OL); g.rect(x + w - 1, y + 1, 1, h - 2, OL);
  g.rect(x + 1, y + 1, w - 2, h - 2, fill);
  g.rect(x + 2, y + h, 2, 1, OL); g.rect(x + 2, y + h + 1, 1, 1, OL); g.rect(x + 3, y + h - 1, 1, 1, fill);
}

export function sayBubble(g: Painter, x: number, y: number, s: string): void {
  const w = txtW(s) + 6;
  bubble(g, x, y, w, 9, '#ffffff'); g.text(s, x + 3, y + 2, OL);
}

export function talkBubble(g: Painter, art: Art, x: number, y: number, t: number): void {
  if (art.get('bubble.talk')) { art.draw(g, 'bubble.talk', x, y, { noAnchor: true, frame: Math.floor(t * 5) % 8 }); return; }
  bubble(g, x, y, 12, 7, '#ffffff');
  const k = Math.floor(t * 5);
  g.rect(x + 2, y + 2, 3 + (hash(k) % 6), 1, OL); g.rect(x + 2, y + 4, 2 + (hash(k + 7) % 5), 1, '#8a8399');
}

export function drawDesk(g: Painter, art: Art, dx: number, dy: number): void {
  art.draw(g, 'prop.desk', dx, dy, { noAnchor: true });
  art.draw(g, 'prop.keyboard', dx + 3, dy, { noAnchor: true });
}

/** Desk rising from the floor (p 0..1) with sawdust. */
export function drawDeskBuilt(g: BufferPainter, art: Art, dx: number, dy: number, p: number, t: number, seed: number): void {
  if (p <= 0) return;
  if (p >= 1) { drawDesk(g, art, dx, dy); return; }
  const top = dy + 11 - Math.ceil(12 * p);
  const prev = g.clip([dx - 1, top, dx + 25, top + 13]);
  drawDesk(g, art, dx, dy);
  g.clip(prev);
  const pa = g.alpha(0.8);
  for (let i = 0; i < 8; i++) {
    const h = hash(i * 31 + seed + Math.floor(t * 10));
    g.rect(dx - 2 + (h % 28), top - ((h >>> 5) % 5), 1, 1, i % 2 ? '#e8dcc8' : '#cfc6b8');
  }
  g.alpha(pa);
}

export function drawChair(g: Painter, art: Art, cx: number, dy: number): void {
  if (!art.draw(g, 'prop.chair', cx, dy)) { g.rect(cx + 1, dy - 7, 8, 8, '#3b3346'); g.rect(cx + 2, dy - 6, 6, 1, '#4d4459'); }
}

export function drawMonitor(g: Painter, mx: number, my: number, st: MonitorState, t: number, seed: number): void {
  monitor(g, mx, my, st, t, seed);
}

export function drawDoor(g: Painter, art: Art, x: number, y: number, open: boolean, ding: number): void {
  art.draw(g, open ? 'prop.door.open' : 'prop.door.closed', x, y);
  if (ding) for (let i = 0; i < 4; i++) {
    const q = (ding + i * 0.25) % 1;
    g.rect(x + 5 + Math.round(Math.cos(i * 1.6) * (3 + q * 6)), y + 2 - Math.round(q * 5), 1, 1, '#ffd23f');
  }
}

export const RUGS = ['#6e3a4c', '#2f5d62', '#4f4380', '#6d5f2b', '#3d5a3a', '#5a3d5c'];

export function drawRug(g: Painter, rx: number, ry: number, rw: number, col: string, label: string, p: number): void {
  const w = Math.round(rw * Math.max(0, Math.min(1, p)));
  if (w <= 0) return;
  g.rect(rx, ry, w, 42, col); g.rect(rx + 1, ry + 1, Math.max(0, w - 2), 40, 'rgba(255,255,255,0.06)');
  g.rect(rx, ry, w, 1, 'rgba(0,0,0,0.3)'); g.rect(rx, ry + 41, w, 1, 'rgba(0,0,0,0.3)');
  for (let y = ry + 2; y < ry + 40; y += 3) g.rect(rx - 1, y, 1, 1, col);
  if (w < rw) {
    g.rect(rx + w - 3, ry - 1, 3, 44, col); g.rect(rx + w - 2, ry - 1, 1, 44, 'rgba(255,255,255,0.25)'); g.rect(rx + w, ry - 1, 1, 44, 'rgba(0,0,0,0.4)');
    return;
  }
  for (let y = ry + 2; y < ry + 40; y += 3) g.rect(rx + rw, y, 1, 1, col);
  // zone label (4×6): the caller fits it to the rug, it never runs past it
  if (!label) return;
  const lw = Math.min(rw - 4, measure(label, FONT_4x6) + 4);
  g.rect(rx + 2, ry + 2, lw, 8, 'rgba(0,0,0,0.35)');
  g.text(label, rx + 4, ry + 3, '#ffe9a8', 1, FONT_4x6);
}

export function drawThermo(g: Painter, x: number, y: number, lvl: number): void { thermo(g, x, y, lvl); }

export function drawPig(g: Painter, art: Art, x: number, y: number, t: number, phase: number): void {
  art.draw(g, 'prop.piggy', x, y, { noAnchor: true });
  const p = ((t + phase) / 2.2) % 1;
  if (p < 0.7) {
    const cy = Math.round(y - 14 + (p / 0.7) * 13), cx = x + 5;
    if (!art.draw(g, 'prop.coin.small', cx, cy, { noAnchor: true })) { g.rect(cx, cy, 3, 3, '#b8860b'); g.rect(cx, cy, 3, 1, '#f5c542'); }
  } else if (p < 0.85) {
    g.rect(x + 4, y - 3, 1, 1, '#fff1a8'); g.rect(x + 8, y - 4, 1, 1, '#fff1a8'); g.rect(x + 6, y - 6, 1, 1, '#ffd23f');
  }
}

export function drawCoin(g: Painter, art: Art, x: number, y: number): void { art.draw(g, 'prop.coin', x, y, { noAnchor: true }); }

export function drawTomb(g: Painter, art: Art, x: number, y: number): void { art.draw(g, 'prop.tomb', x, y); }

export function drawGhost(g: Painter, art: Art, x: number, y: number, t: number): void {
  const pa = g.alpha(0.65 + 0.25 * Math.sin(t * 3));
  art.draw(g, 'prop.ghost', x, Math.round(y + Math.sin(t * 2) * 2), { t, noAnchor: true });
  g.alpha(pa);
}

/** Subagents: little characters next to the parent's desk. */
export function drawMinis(g: Painter, art: Art, x: number, y: number, look: Look, n: number, t: number, alpha = 1): void {
  const pa = g.alpha(alpha);
  for (let i = 0; i < n; i++) {
    const b = Math.floor(t * 4 + i) % 2;
    art.draw(g, 'char.mini', x + i * 8, y - b, { palette: look.pal, noAnchor: true });
    g.rect(x + i * 8 + 1, y + 8, 4, 1, 'rgba(0,0,0,0.25)');
  }
  g.alpha(pa);
}

const DECO_PROP: Record<string, string> = { plant: 'prop.plant', sofa: 'prop.sofa', cooler: 'prop.cooler', table: 'prop.table', shelf: 'prop.shelf', lamp: 'prop.lamp' };

/** Basic furniture (plant, sofa…) and pop decor (deco.*), animated by fps. */
export function drawDeco(g: Painter, art: Art, d: { id: string; x: number; y: number }, t: number): void {
  const x = d.x, y = d.y;
  const prop = DECO_PROP[d.id];
  if (prop) {
    art.draw(g, prop, x + (d.id === 'sofa' ? 2 : 0), y, { noAnchor: d.id !== 'sofa' && d.id !== 'lamp', t });
    if (d.id === 'cooler') { const q = (t % 3) / 3; if (q < 0.5) g.rect(x + 3, y + 4 - Math.round(q * 8), 1, 1, '#ffffff'); }
    if (d.id === 'lamp') { const pa = g.alpha(0.25); g.rect(x - 1, y + 5, 7, 2, '#fff1a8'); g.alpha(pa); }
    return;
  }
  art.draw(g, d.id, x, y, { t, noAnchor: true });
}

export function drawRack(g: Painter, art: Art, x: number, y: number): void {
  art.draw(g, 'prop.rack', x, y, { noAnchor: true });
}

export type PodState = 'run' | 'fire' | 'frozen' | 'dead' | 'empty';

/** Kindling capsule: base + back, the character, then the glass front. fx: beam (0..1) or mat (materialize 0..1). */
export function drawPod(g: Painter, art: Art, px: number, py: number, look: Look, seed: number, st: PodState, t: number, fx: { beam?: number; mat?: number } = {}): void {
  const s = st;
  art.draw(g, `pod.base.${s}`, px, py + 26, { noAnchor: true });
  if (s === 'fire' && Math.floor(t * 6) % 2) g.rect(px + 3, py + 28, 16, 1, '#ffd23f');
  art.draw(g, `pod.back.${s}`, px, py);
  const cx = px + 2, cy = py + 10;
  if (s === 'empty') {
    if (fx.beam != null) beam(g, px + 11, py - 26, py + 25, fx.beam, t);
    art.draw(g, `pod.front.${s}`, px, py);
    return;
  }
  if (s === 'fire') fire(g, px + 1, py + 25, 20, 13, t, seed);
  if (s !== 'dead') { g.rect(px + 12, py + 13, 8, 6, '#2a2733'); monitor(g, px + 11, py + 11, s === 'run' ? 'work' : s === 'fire' ? 'fire' : 'off', t, seed); }
  if (s === 'run') {
    drawChar(g, art, cx, cy, look, { face: ((t + seed) % 3.3) < 0.12 ? 'blink' : null });
    const a = Math.floor(t * 9 + seed) % 2;
    g.rect(cx + 2, py + 20 - a, 1, 1, look.pal.S!); g.rect(cx + 7, py + 20 - (1 - a), 1, 1, look.pal.S!);
    if (fx.mat != null && fx.mat < 1) {
      for (let yy = cy - 2; yy < py + 21; yy++) for (let xx = cx - 1; xx < cx + 9; xx++) {
        const h = (hash(xx * 131 + yy * 7) % 1000) / 1000;
        if (h > fx.mat) g.rect(xx, yy, 1, 1, yy >= py + 20 ? '#5c6670' : '#1f2a33');
        else if (fx.mat - h < 0.08) g.rect(xx, yy, 1, 1, '#bff8ff');
      }
      beam(g, px + 11, py - 26, py + 25, 1, t);
    }
  } else if (s === 'fire') {
    const j = Math.floor(t * 14) % 2;
    drawChar(g, art, cx + j, cy - 1, look, { face: 'scream', pose: 'up' });
    fire(g, px + 2, py + 25, 18, 5, t + 1.3, seed + 5);
    smoke(g, px + 9, py - 1, t + seed);
  } else if (s === 'frozen') {
    drawChar(g, art, cx, cy, { ...look, pal: icePal(look.pal) }, { face: 'blink' });
    const pa = g.alpha(0.3); g.rect(cx - 1, cy - 3, 12, 14, '#9fdcff'); g.alpha(pa);
    g.rect(cx - 1, cy - 3, 12, 1, '#ffffff'); g.rect(cx - 1, cy - 3, 1, 14, '#ffffff');
    for (let i = 0; i < 3; i++) {
      const k = Math.floor(t * 2 + i * 3);
      if (hash(k + seed) % 3 === 0) {
        const sx = px + 2 + (hash(k * 7 + i) % 18), sy = py + 2 + (hash(k * 13 + i) % 20);
        g.rect(sx, sy, 1, 1, '#ffffff'); g.rect(sx - 1, sy, 1, 1, 'rgba(255,255,255,0.5)'); g.rect(sx + 1, sy, 1, 1, 'rgba(255,255,255,0.5)');
      }
    }
  } else if (s === 'dead') {
    drawTomb(g, art, px + 6, py + 13);
    drawGhost(g, art, px + 7, py - 12, t + seed);
  }
  art.draw(g, `pod.front.${s}`, px, py);
  if (s === 'fire') { const gc = Math.floor(t * 8) % 2 ? '#ff9a5c' : '#ffd23f'; g.rect(px + 2, py, 18, 1, gc); g.rect(px, py + 2, 1, 24, gc); g.rect(px + 21, py + 2, 1, 24, gc); }
}

/** Builder with hard hat swinging a hammer (prototype drawBuilder). */
export function drawBuilder(g: Painter, art: Art, x: number, y: number, look: Look, t: number): void {
  x = Math.round(x); y = Math.round(y);
  const up = Math.floor(t * 10) % 2;
  drawChar(g, art, x, y, look, { legs: up ? 0 : 1 });
  const hx = x + 9;
  if (up) art.draw(g, 'item.hammer.up', hx, y + 2);
  else {
    art.draw(g, 'item.hammer.down', hx, y + 9, { noAnchor: true });
    g.rect(hx + 4, y + 12, 1, 1, '#ffd23f'); g.rect(hx + 3, y + 13, 1, 1, '#fff6c9'); g.rect(hx + 5, y + 11, 1, 1, '#fff6c9');
  }
}
