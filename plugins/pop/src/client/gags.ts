import { OL, POP_C, clamp, hash, type Painter } from './painter.js';

/**
 * Agent gags (port of POP_GAGS in design/prototype/pop.js). The seated agent's sprite top-left
 * is (x, y); the desk is at y+10. `draw` paints inside x-10..x+20, y-26..y+12 with integer coordinates.
 * `pose(p)` tells the seat how to move the agent (`lift` in px, `arms: 'up'`).
 */
export interface GagPose {
  lift?: number;
  arms?: 'up';
}
export interface Gag {
  name: string;
  /** Duration in seconds; p runs 0..1 over it. */
  dur: number;
  pose?(p: number): GagPose;
  draw(g: Painter, x: number, y: number, p: number, t: number): void;
}

const PAL_BLOCK = { O: OL, Y: '#f0a030', d: '#8a4a12', B: POP_C.wood, b: POP_C.woodD };
const BLOCK = [
  'OOOOOOOOOO', 'OdYYYYYYdO', 'OYYOOOOYYO', 'OYOOYYOOYO', 'OYYYYOOYYO',
  'OYYYOOYYYO', 'OYYYYYYYYO', 'OYYYOOYYYO', 'OdYYYYYYdO', 'OOOOOOOOOO',
];
const BLOCK_USED = [
  'OOOOOOOOOO', 'ObBBBBBBbO', 'OBbBBBBbBO', 'OBBBBBBBBO', 'OBBBBBBBBO',
  'OBBBBBBBBO', 'OBBBBBBBBO', 'OBbBBBBbBO', 'ObBBBBBBbO', 'OOOOOOOOOO',
];
const PAL_COIN = { O: OL, y: POP_C.goldD, Y: POP_C.gold, w: POP_C.goldL };
const COIN = ['.OOO.', 'OyYyO', 'OYwYO', 'OYYyO', '.OOO.'];
const PAL_SWORD = { O: OL, w: '#d5d9e0', s: POP_C.grey, y: '#d9a441', b: POP_C.woodD };
const SWORD = [
  '..OO..', '.OwsO.', '.OwsO.', '.OwsO.', '.OwsO.', '.OwsO.', '.OwsO.',
  'OOOOOO', 'OyyyyO', 'OOOOOO', '.ObbO.', '.ObbO.', '.OyyO.', '..OO..',
];
const PAL_PIPE = { O: OL, l: POP_C.greenL, G: POP_C.green, d: POP_C.greenD };
const PIPE_CAP = ['OOOOOOOOOOOOOO', 'OllGGGGGGGGddO', 'OllGGGGGGGGddO', 'OOOOOOOOOOOOOO'];
const PAL_SHROOM = { O: OL, r: POP_C.red, w: POP_C.white, c: POP_C.skin, e: OL };
const SHROOM = ['..OOOO..', '.OrwwrO.', 'OwrrrrwO', 'OrrrrrrO', 'OOOOOOOO', '.OccccO.', '.OecceO.', '..OOOO..'];
const PAL_GHOST = { O: OL, C: POP_C.cyan, w: POP_C.white, b: '#2f5fb3' };
const GHOST: readonly (readonly string[])[] = [
  ['..OOOO..', '.OCCCCO.', 'OCwwCwwO', 'OCwbCwbO', 'OCCCCCCO', 'OCCCCCCO', 'OCCCCCCO', 'OC.CC.CO'],
  ['..OOOO..', '.OCCCCO.', 'OCwwCwwO', 'OCwbCwbO', 'OCCCCCCO', 'OCCCCCCO', 'OCCCCCCO', 'O.CCCC.O'],
];
const PAL_ALIEN = { A: POP_C.lime };
const ALIEN: readonly (readonly string[])[] = [
  ['..A.....A..', '...A...A...', '..AAAAAAA..', '.AA.AAA.AA.', 'AAAAAAAAAAA', 'A.AAAAAAA.A', 'A.A.....A.A', '...AA.AA...'],
  ['..A.....A..', 'A..A...A..A', 'A.AAAAAAA.A', 'AAA.AAA.AAA', 'AAAAAAAAAAA', '.AAAAAAAAA.', '..A.....A..', '.A.......A.'],
];

/** Plus-shaped sparkle (3x3, or 5x5 when big) centered on (cx, cy). */
function sparkle(g: Painter, cx: number, cy: number, c: string, big?: boolean): void {
  g.rect(cx, cy, 1, 1, c);
  g.rect(cx - 1, cy, 1, 1, c); g.rect(cx + 1, cy, 1, 1, c);
  g.rect(cx, cy - 1, 1, 1, c); g.rect(cx, cy + 1, 1, 1, c);
  if (big) { g.rect(cx - 2, cy, 1, 1, c); g.rect(cx + 2, cy, 1, 1, c); g.rect(cx, cy - 2, 1, 1, c); g.rect(cx, cy + 2, 1, 1, c); }
}
/** 2x2 tetromino cell with a highlight corner. */
function cellAt(g: Painter, x: number, y: number, c: string, light: string): void {
  g.rect(x, y, 2, 2, c); g.rect(x, y, 1, 1, light);
}
/** Text with a 1 px shadow so it reads on any background. */
function shadowText(g: Painter, s: string, x: number, y: number, c: string): void {
  g.text(s, x + 1, y + 1, OL, 1); g.text(s, x, y, c, 1);
}

export const GAGS: Record<string, Gag> = {
  bloque: {
    name: 'Golpe al bloque', dur: 1.6,
    pose: (p) => ({ lift: p < 0.5 ? Math.round(5 * Math.sin((p / 0.5) * Math.PI)) : 0 }),
    draw(g, x, y, p, t) {
      const hit = p >= 0.3;
      const bump = p >= 0.3 && p < 0.45 ? 2 : 0;
      if (hit && p < 0.85) {
        const q = (p - 0.3) / 0.55;
        const cy = y - 18 - Math.round(8 * Math.sin(q * Math.PI));
        g.sprite(COIN, x + 2 + Math.round(q * 3), cy, PAL_COIN);
      }
      g.sprite(hit ? BLOCK_USED : BLOCK, x, y - 16 - bump, PAL_BLOCK);
      if (p >= 0.85) {
        const k = Math.floor(t * 10);
        sparkle(g, x + 5 + (k % 2), y - 23, k % 2 ? POP_C.goldL : '#ffffff', k % 2 === 0);
      }
      if (hit && p < 0.5) { g.rect(x - 2, y - 7, 1, 1, '#ffffff'); g.rect(x + 11, y - 7, 1, 1, '#ffffff'); }
    },
  },

  espada: {
    name: 'Objeto conseguido', dur: 2.0,
    pose: () => ({ arms: 'up' }),
    draw(g, x, y, p, t) {
      const up = Math.round((1 - clamp(p / 0.15, 0, 1)) * 6);
      const cx = x + 5, cy = y - 9;
      if (p > 0.15) {
        const rot = Math.floor(t * 6) % 2;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + rot * (Math.PI / 8);
          const len = 7 + Math.floor(hash(i + Math.floor(t * 4)) % 3);
          for (let d = 6; d <= len; d++) {
            const px = cx + Math.round(Math.cos(a) * d), py = cy + Math.round(Math.sin(a) * d);
            if (py < y - 20 || py > y - 1 || px < x - 6 || px > x + 15) continue;
            g.rect(px, py, 1, 1, (d + i) % 2 ? POP_C.yellow : POP_C.cream);
          }
        }
      }
      g.sprite(SWORD, x + 2, y - 15 + up, PAL_SWORD);
      if (p > 0.4 && Math.floor(t * 5) % 2) g.rect(x + 4, y - 11 + (Math.floor(t * 3) % 4), 1, 1, '#ffffff');
    },
  },

  tuberia: {
    name: 'Por la tubería', dur: 2.4,
    pose(p) {
      const d = 12;
      const lift = p < 0.35 ? -Math.round((d * p) / 0.35) : p < 0.65 ? -d : -Math.round((d * (1 - p)) / 0.35);
      return { lift };
    },
    draw(g, x, y, p, t) {
      g.sprite(PIPE_CAP, x - 2, y + 6, PAL_PIPE);
      if ((p > 0.2 && p < 0.45) || (p > 0.6 && p < 0.85)) {
        for (let i = 0; i < 3; i++) {
          const q = (t * 1.5 + i / 3) % 1;
          const bx = x + 1 + (hash(i + 7) % 8), by = y + 5 - Math.round(q * 6);
          g.rect(bx, by, 1, 1, i % 2 ? POP_C.greenL : '#ffffff');
        }
      }
      if (p >= 0.4 && p < 0.6) shadowText(g, '...', x + 2, y - 3, POP_C.greenL);
    },
  },

  seta: {
    name: 'Seta de poder', dur: 2.0,
    pose(p) {
      if (p < 0.45 || p > 0.85) return { lift: 0 };
      return { lift: Math.round(3 * Math.abs(Math.sin(((p - 0.45) / 0.4) * Math.PI * 2))) };
    },
    draw(g, x, y, p, t) {
      if (p < 0.4) {
        const sx = x + 12 - Math.round((p / 0.4) * 4);
        g.sprite(SHROOM, sx, y + 1, PAL_SHROOM);
      } else if (p < 0.5) {
        const k = Math.floor(t * 12);
        g.rect(x + 9 + (k % 2), y + 2, 1, 1, POP_C.red); g.rect(x + 11, y + 4 + (k % 3), 1, 1, POP_C.white);
        g.rect(x + 8, y + 6, 1, 1, POP_C.red);
      } else if (p < 0.85) {
        const k = Math.floor(t * 8);
        for (let i = 0; i < 3; i++) {
          const h = hash(k * 3 + i);
          const sx = x - 5 + (h % 20), sy = y - 12 + ((h >>> 5) % 14);
          sparkle(g, sx, sy, (h >>> 9) % 2 ? POP_C.yellow : POP_C.white, false);
        }
      }
      if (p > 0.45 && p < 0.8) {
        const ty = y - 12 - Math.round(((p - 0.45) / 0.35) * 8);
        shadowText(g, 'YUM!', x - 2, ty, Math.floor(t * 6) % 2 ? POP_C.yellow : POP_C.cream);
      }
    },
  },

  fantasma: {
    name: 'Fantasma comilón', dur: 2.2,
    draw(g, x, y, p, t) {
      const gx = x - 10 + Math.round(p * 22);
      const gy = y - 13;
      for (let i = 0; i < 6; i++) {
        const dx = x - 6 + i * 4;
        if (gx + 4 > dx) continue;
        g.rect(dx, y - 10, 2, 2, '#ffe9b0');
      }
      g.sprite(GHOST[Math.floor(t * 6) % 2] ?? [], gx, gy, PAL_GHOST);
    },
  },

  tetris: {
    name: 'Línea completa', dur: 2.4,
    draw(g, x, y, p, t) {
      const wx = x + 11, wy = y - 23; // interior 8×16 (4×8 cells)
      const border = POP_C.greyD;
      g.rect(x + 10, y - 23, 1, 16, border); g.rect(x + 19, y - 23, 1, 16, border); g.rect(x + 10, y - 7, 10, 1, border);
      const cell = (c: number, r: number, col: string, light: string) => cellAt(g, wx + c * 2, wy + r * 2, col, light);
      const cleared = p >= 0.8;
      const flash = p >= 0.6 && p < 0.8;
      const base = [[0, 7], [1, 7], [2, 7]] as const;
      const upper = [[0, 6], [1, 6]] as const;
      const drop = cleared ? 1 : 0;
      if (!cleared) for (const q of base) cell(q[0], q[1], flash && Math.floor(t * 10) % 2 ? '#ffffff' : POP_C.blue, flash ? '#ffffff' : POP_C.sky);
      for (const q of upper) cell(q[0], q[1] + drop, POP_C.magenta, POP_C.pink);
      const row = p < 0.6 ? Math.min(4, -1 + Math.floor((p / 0.6) * 6)) : 4;
      for (let k = 0; k < 4; k++) {
        const r = row + k;
        if (cleared && r === 7) continue;
        const rr = r + (cleared ? 1 : 0);
        if (rr < -1 || rr > 7) continue;
        const col = flash && r === 7 && Math.floor(t * 10) % 2 ? '#ffffff' : POP_C.cyan;
        cell(3, rr, col, POP_C.cyanL);
      }
      if (cleared) shadowText(g, '+100', x - 6, y - 20, Math.floor(t * 6) % 2 ? POP_C.yellow : POP_C.cream);
    },
  },

  invader: {
    name: 'Alien abatido', dur: 2.2,
    pose: (p) => ({ lift: p > 0.6 && p < 0.72 ? 2 : 0 }),
    draw(g, x, y, p, t) {
      const step = Math.floor(t * 3) % 2;
      if (p < 0.6) {
        const ax = x + (step ? 1 : -1);
        const ay = y - 26 + Math.round(8 * clamp(p / 0.45, 0, 1));
        g.sprite(ALIEN[step] ?? [], ax, ay, PAL_ALIEN);
      }
      if (p >= 0.45 && p < 0.6) {
        const q = (p - 0.45) / 0.15;
        const sy = y - 1 - Math.round(9 * q);
        g.rect(x + 5, sy, 1, 3, POP_C.yellow);
      }
      if (p >= 0.6 && p < 0.8) {
        const q = (p - 0.6) / 0.2;
        const rad = 1 + Math.round(q * 4);
        const cx = x + 5, cy = y - 14;
        const c = q < 0.5 ? POP_C.cream : POP_C.orange;
        g.rect(cx - rad, cy, 1, 1, c); g.rect(cx + rad, cy, 1, 1, c); g.rect(cx, cy - rad, 1, 1, c); g.rect(cx, cy + rad, 1, 1, c);
        const d = Math.max(1, rad - 1);
        g.rect(cx - d, cy - d, 1, 1, c); g.rect(cx + d, cy - d, 1, 1, c); g.rect(cx - d, cy + d, 1, 1, c); g.rect(cx + d, cy + d, 1, 1, c);
        if (q < 0.4) g.rect(cx - 1, cy - 1, 3, 3, POP_C.yellow);
      }
      if (p >= 0.8) shadowText(g, '+50', x, y - 18, Math.floor(t * 6) % 2 ? POP_C.lime : '#ffffff');
    },
  },

  lvup: {
    name: 'Subida de nivel', dur: 2.0,
    pose: (p) => ({ lift: Math.round(4 * Math.abs(Math.sin(p * Math.PI * 2))) }),
    draw(g, x, y, p, t) {
      const ty = y - 12 - Math.round(10 * clamp(p / 0.6, 0, 1));
      const cols = [POP_C.yellow, '#ffffff', POP_C.lime] as const;
      shadowText(g, 'LV UP', x - 4, ty, cols[Math.floor(t * 8) % 3] ?? '#ffffff');
      if (p < 0.9) {
        const k = Math.floor(t * 4);
        for (let i = 0; i < 5; i++) {
          const h = hash(i * 17 + k);
          const sx = x - 7 + (h % 24), sy = y - 24 + ((h >>> 5) % 22);
          sparkle(g, sx, sy, (h >>> 10) % 2 ? POP_C.yellow : POP_C.cream, (h >>> 12) % 3 === 0);
        }
      }
    },
  },
};
