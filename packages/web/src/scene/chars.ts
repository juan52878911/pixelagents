/**
 * Characters assembled from `char.<view>.<part>` sprites + overlays (port of drawChar), and skins:
 * config `skins[name]` (palette, accessory, item, base) over the per-account defaults of
 * `assets/animations.json`, with skin tone and hair picked from the entity id.
 */
import type { PaConfig, SkinConfig } from '@pixelagents/protocol';
import type { Painter } from '../engine/painter.js';
import { ANIMATIONS, type Art } from './art.js';

export const OL = '#1a1423';

export interface Look {
  /** Full character palette (H S s E m B b P K + accessory keys). */
  pal: Record<string, string>;
  /** Accessory overlays (acc.*), drawn after the parts. */
  overlays: string[];
  /** Hair overlay (hair.long / hair.bun) or null. */
  hair: string | null;
  /** Item sprite carried on arrival (item.briefcase …) or null. */
  item: string | null;
  /** Base sprite set, default "char". */
  base: string;
}

export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

type AccountDef = { overlays?: string[]; item?: string; colors?: Record<string, string> };

/** Look for an entity: skin name (view.skin) + a seed from its id. */
export function lookFor(skinName: string | undefined, seed: number, config: PaConfig | null): Look {
  const accounts = ANIMATIONS.accounts as Record<string, AccountDef>;
  const sk = ANIMATIONS.skins;
  const name = skinName || 'default';
  const acc: AccountDef = accounts[name] ?? {};
  const cfg: SkinConfig = config?.skins?.[name] ?? (accounts[name] ? {} : config?.skins?.default ?? {});
  const tone = sk.skin[seed % sk.skin.length]!;
  const pal: Record<string, string> = {
    H: sk.hair[(seed * 7 + 3) % sk.hair.length]!, S: tone[0]!, s: tone[1]!, E: OL, m: '#7a2a2a',
    B: '#3b7dd8', b: '#2756a3', P: '#34304a', K: '#15121c', W: '#f4efe6', T: '#7a1e2c', A: '#dfe7f7', a: '#6fa3ff', C: '#3fc79a', c: '#25916c',
    ...acc.colors, ...cfg.palette,
  };
  const overlays = cfg.accessory ? [cfg.accessory] : acc.overlays ?? [];
  const hairs = sk.hairOverlays;
  const hair = hairs[(seed >>> 3) % hairs.length] ?? null;
  return { pal, overlays, hair, item: cfg.item ?? acc.item ?? null, base: cfg.base ?? 'char' };
}

export function builderLook(seed: number): Look {
  return lookFor('builder', seed, null);
}

export type View = 'front' | 'side' | 'back';
export interface CharOpts {
  view?: View;
  flip?: boolean;
  face?: 'blink' | 'sleep' | 'talk' | 'scream' | null;
  pose?: 'up';
  /** null/undefined = seated (no legs), else legs frame 0..2 */
  legs?: number | null;
  /** walking hand frame (side view) */
  hand?: number;
}

/** Character with its top-left at (x, y) (10×14 box, 10 rows when seated). */
export function drawChar(g: Painter, art: Art, x: number, y: number, look: Look, o: CharOpts = {}): void {
  x = Math.round(x); y = Math.round(y);
  const view = o.view ?? 'front', fl = !!o.flip, b = look.base;
  const pal = look.pal;
  let head = `${b}.${view}.head`;
  if (o.face === 'blink' && art.get(head + '.blink')) head += '.blink';
  else if (o.face === 'sleep' && art.get(head + '.sleep')) head += '.sleep';
  else if (o.face === 'talk' && art.get(head + '.talk')) head += '.talk';
  else if (o.face === 'scream' && art.get(head + '.scream')) head += '.scream';
  const seated = o.legs == null;
  let body = `${b}.${view}.body`;
  if (view !== 'side') {
    if (o.pose === 'up' && art.get(body + '.up')) body += '.up';
    else if (seated && art.get(body + '.seat')) body += '.seat';
  }
  art.draw(g, head, x, y, { palette: pal, flip: fl, noAnchor: true });
  art.draw(g, body, x, y + 6, { palette: pal, flip: fl, noAnchor: true });
  if (!seated) art.draw(g, `${b}.${view}.legs`, x, y + 10, { palette: pal, flip: fl, frame: o.legs ?? 0, noAnchor: true });
  if (look.hair && view !== 'back') art.drawOverlay(g, look.hair, view, x, y, pal, fl);
  if (o.pose === 'up' && view !== 'side') art.drawOverlay(g, 'char.arms.up', view, x, y, pal, fl);
  for (const ov of look.overlays) art.drawOverlay(g, ov, view, x, y, pal, fl);
  if (view === 'side' && !seated) art.drawOverlay(g, o.hand ? 'char.hand.b' : 'char.hand.a', 'side', x, y, pal, fl);
}

/** Item carried while walking (meta.at per view; side views also by hand frame and flip). */
export function drawItem(g: Painter, art: Art, x: number, y: number, item: string | null, view: View, flip: boolean, hand: number, t: number): void {
  if (!item) return;
  x = Math.round(x); y = Math.round(y);
  let name = item;
  if (item === 'item.backpack.front') name = view === 'side' ? 'item.backpack.side' : view === 'back' ? 'item.backpack.back' : 'item.backpack.front';
  const s = art.get(name);
  if (!s) return;
  const at = (s.meta?.at ?? {}) as Record<string, [number, number]>;
  const key = view === 'side' ? `side${hand ? '.hand' : ''}${flip ? '.flip' : ''}` : view;
  const p = at[key] ?? at[view] ?? at.front;
  if (!p) return;
  art.draw(g, name, x + p[0], y + p[1], { noAnchor: true, t });
  const steam = s.meta?.steam as { color?: string; alpha?: number } | undefined;
  if (steam) {
    const pa = g.alpha(steam.alpha ?? 0.6);
    g.rect(x + p[0] + (Math.floor(t * 3) % 2), y + p[1] - 2 - (Math.floor(t * 3) % 2), 1, 1, steam.color ?? '#ffffff');
    g.alpha(pa);
  }
}

/** Item left on the desk when seated (`<item>.seated`, meta {dx, dy} from the desk corner). */
export function drawItemSeated(g: Painter, art: Art, dx: number, dy: number, item: string | null, t: number): void {
  if (!item) return;
  const base = item.replace(/\.front$/, '');
  const s = art.get(base + '.seated');
  if (!s) return;
  const m = s.meta as { dx?: number; dy?: number; steam?: { color?: string; alpha?: number } } | undefined;
  art.draw(g, s.name, dx + (m?.dx ?? 0), dy + (m?.dy ?? 0), { noAnchor: true, t });
  if (m?.steam) {
    const q = (t * 0.8) % 1;
    const pa = g.alpha((m.steam.alpha ?? 0.7) * (1 - q));
    g.rect(dx + (m.dx ?? 0) + Math.round(Math.sin(t * 3)), dy + (m.dy ?? 0) - 2 - Math.round(q * 4), 1, 1, m.steam.color ?? '#ffffff');
    g.alpha(pa);
  }
}

/** Blue-ish palette for frozen VMs (prototype icePal). */
export function icePal(p: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, c] of Object.entries(p)) {
    if (!c || c[0] !== '#') continue;
    const n = parseInt(c.slice(1, 7), 16);
    const l = (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
    o[k] = l < 0.25 ? '#16304d' : l < 0.45 ? '#2f5f8f' : l < 0.7 ? '#5f9fd0' : '#bfe6ff';
  }
  return o;
}
