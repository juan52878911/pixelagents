import type { Rng } from './rng.js';

/** Mutable view of an office while the world is being generated. */
export interface OfficeDraft {
  tx: number; ty: number; tw: number; th: number;
  isLab: boolean;
}

export interface GrowCtx {
  own: number[][];
  cols: number;
  rows: number;
  rg: Rng;
  /** tile is grass, not reserved, and at least one tile away from other offices */
  free(c: number, r: number, oi: number): boolean;
}

export type StrategyFn = (o: OfficeDraft, oi: number, cx: GrowCtx, count?: number) => void;

const registry = new Map<string, StrategyFn>();

export function registerStrategy(name: string, fn: StrategyFn): void {
  registry.set(name, fn);
}
export function getStrategy(name: string): StrategyFn | undefined {
  return registry.get(name);
}
export function strategyNames(): string[] {
  return [...registry.keys()];
}

const D4: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function addRect(oi: number, cx: GrowCtx, x: number, y: number, w: number, h: number, anchor: string, strict = false): boolean {
  const { own } = cx;
  for (let tries = 0; tries < 8; tries++) {
    let ok = w >= 2 && h >= 2;
    for (let r = y; ok && r < y + h; r++) for (let c = x; ok && c < x + w; c++) if (!(own[r] && own[r]![c] === oi) && !cx.free(c, r, oi)) ok = false;
    if (ok) {
      for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) (own[r] as number[])[c] = oi;
      return true;
    }
    if (strict) return false;
    if (h > 2) h--;
    else if (w > 3) { w--; if (anchor === 'left') x++; }
    else return false;
  }
  return false;
}

const alas: StrategyFn = (o, oi, cx) => {
  const rg = cx.rg;
  for (let k = 0, n = rg.i(1, 3); k < n; k++) {
    const side = rg.pick(['bottom', 'bottom', 'left', 'right']);
    if (side === 'bottom') {
      const ww = rg.i(4, Math.max(4, Math.min(12, o.tw - 2)));
      addRect(oi, cx, o.tx + rg.i(0, Math.max(0, o.tw - ww)), o.ty + o.th, ww, rg.i(2, 5), 'down');
    } else {
      const ww = rg.i(3, 7);
      addRect(oi, cx, side === 'left' ? o.tx - ww : o.tx + o.tw, o.ty + rg.i(3, Math.max(3, o.th - 3)), ww, rg.i(3, 7), side);
    }
  }
};

const escalera: StrategyFn = (o, oi, cx) => {
  const rg = cx.rg, dir = rg.f() < 0.5 ? 1 : -1;
  const w0 = rg.i(7, Math.max(7, Math.min(13, o.tw - 2)));
  let w = w0;
  let x = dir > 0 ? o.tx + rg.i(0, 3) : o.tx + o.tw - w - rg.i(0, 3);
  let y = o.ty + o.th;
  for (let s = 0, n = rg.i(2, 4); s < n && w >= 4; s++) {
    if (!addRect(oi, cx, x, y, w, 2, 'down', true)) break;
    const sh = rg.i(2, Math.max(2, w - 3));
    y += 2; x += dir * sh; w -= rg.i(0, 2);
  }
};

const mancha: StrategyFn = (o, oi, cx, count) => {
  const rg = cx.rg, { own } = cx;
  const r0 = o.ty + 3, r1 = Math.min(cx.rows, o.ty + o.th + 18);
  const c0 = Math.max(0, o.tx - 12), c1 = Math.min(cx.cols, o.tx + o.tw + 12);
  for (let k = 0, n = count || rg.i(18, 40); k < n; k++) {
    const cand: [number, number][] = [];
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if ((own[r] as number[])[c] === oi)
      for (const d of D4) if (cx.free(c + d[0], r + d[1], oi)) cand.push([c + d[0], r + d[1]]);
    if (!cand.length) break;
    const q = rg.pick(cand);
    (own[q[1]] as number[])[q[0]] = oi;
  }
  // fill pockets so the blob reads as one room
  for (let r = o.ty; r < r1; r++) for (let c = c0; c < c1; c++) if (cx.free(c, r, oi)) {
    let n = 0;
    for (const d of D4) if (own[r + d[1]] && own[r + d[1]]![c + d[0]] === oi) n++;
    if (n >= 3) (own[r] as number[])[c] = oi;
  }
};

const mordida: StrategyFn = (o, oi, cx) => {
  const rg = cx.rg, r = o.ty + o.th - 1, row = cx.own[r] as number[];
  for (let c = 0, n = rg.i(1, 3); c < n; c++) row[o.tx + c] = -1;
  for (let c = 0, n = rg.i(1, 2); c < n; c++) row[o.tx + o.tw - 1 - c] = -1;
  mancha(o, oi, cx, rg.i(8, 18));
};

const cueva: StrategyFn = (o, oi, cx) => {
  const rg = cx.rg;
  const x0 = o.tx + rg.i(1, 6), x1 = o.tx + o.tw - rg.i(1, 6);
  const y0 = o.ty + o.th, y1 = Math.min(cx.rows - 1, y0 + rg.i(4, 7));
  let alive: Record<string, 1> = {};
  const key = (c: number, r: number): string => c + ',' + r;
  for (let r = y0; r <= y1; r++) for (let c = x0; c < x1; c++) if (cx.free(c, r, oi) && (r === y0 || rg.f() < 0.55)) alive[key(c, r)] = 1;
  for (let it = 0; it < 4; it++) {
    const next: Record<string, 1> = {};
    for (let r = y0; r <= y1; r++) for (let c = x0; c < x1; c++) {
      if (!cx.free(c, r, oi)) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) {
        const rr = r + dr, cc = c + dc;
        if (alive[key(cc, rr)] || (rr < y0 && cx.own[rr] && cx.own[rr]![cc] === oi)) n++;
      }
      if (n >= 5 || (alive[key(c, r)] && n >= 4)) next[key(c, r)] = 1;
    }
    alive = next;
  }
  const stack: [number, number][] = [];
  for (let c = x0; c < x1; c++) if (alive[key(c, y0)]) stack.push([c, y0]);
  const seen: Record<string, 1> = {};
  while (stack.length) {
    const q = stack.pop() as [number, number], k = key(q[0], q[1]);
    if (seen[k] || !alive[k]) continue;
    seen[k] = 1;
    (cx.own[q[1]] as number[])[q[0]] = oi;
    for (const d of D4) stack.push([q[0] + d[0], q[1] + d[1]]);
  }
};

registerStrategy('alas', alas);
registerStrategy('escalera', escalera);
registerStrategy('mancha', mancha);
registerStrategy('mordida', mordida);
registerStrategy('cueva', cueva);

/** Default pools, as in the prototype. */
export const POOL_OFFICE = ['alas', 'escalera', 'mancha', 'mordida'];
export const POOL_LAB = ['cueva', 'cueva', 'mancha', 'alas'];
