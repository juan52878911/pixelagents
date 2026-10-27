/**
 * A world growth strategy: how an office extends its footprint when it needs more room.
 * Enable it from config: `"world": { "strategies": ["columna"] }`. The generator calls it with the
 * office rectangle (tile units), its index `oi`, a grid of owners `cx.own` (own[r][c] = office index)
 * and a seeded rng, so the same seed gives the same town.
 */
import type { GrowCtx, OfficeDraft } from '../../packages/web/src/world/strategies.js';

export function columna(o: OfficeDraft, oi: number, cx: GrowCtx): void {
  const w = cx.rg.i(2, 3), h = cx.rg.i(3, 6);
  const x = o.tx + o.tw; // to the right of the office
  const y = o.ty + cx.rg.i(0, Math.max(0, o.th - h));
  for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (!cx.free(c, r, oi)) return; // all or nothing
  for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) (cx.own[r] as number[])[c] = oi;
}

export default { name: 'columna-demo', strategies: { columna } };
