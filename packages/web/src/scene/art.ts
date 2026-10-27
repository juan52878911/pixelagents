/**
 * Art: the default `assets/*.px.json` (bundled by Vite) plus whatever the server lists in
 * `/api/assets` (later files override earlier ones). Sprites are drawn through the engine's Painter
 * from their text rows, so a hot reload only swaps the rows.
 */
import type { PxFile, PxSprite, OverlaySprite } from '@pixelagents/protocol';
import type { Painter } from '../engine/painter.js';
import type { SpriteLibrary } from '../engine/library.js';
import animationsJson from '../../../../assets/animations.json';

const bundled = import.meta.glob('../../../../assets/*.px.json', { eager: true, import: 'default' }) as Record<string, PxFile>;

export type Animations = typeof animationsJson;
export const ANIMATIONS: Animations = animationsJson;

export class Art {
  private sprites = new Map<string, PxSprite>();
  private overlays = new Map<string, OverlaySprite>();
  /** Bumps on every reload; caches keyed on it. */
  version = 0;

  constructor(private lib?: SpriteLibrary) { this.reset([]); }

  /** Defaults + extra files, in order. */
  reset(extra: PxFile[]): void {
    this.sprites.clear(); this.overlays.clear();
    this.lib?.clear();
    const files = [...Object.keys(bundled).sort().map((k) => bundled[k]!), ...extra];
    for (const f of files) {
      for (const s of f.sprites ?? []) this.sprites.set(s.name, s);
      for (const o of f.overlays ?? []) this.overlays.set(o.name, o);
      try { this.lib?.addFile(f); } catch { /* library is optional for drawing */ }
    }
    this.version++;
  }

  /** Fetches every `.px.json` listed by `/api/assets` and reloads. Failures keep the defaults. */
  async loadServer(fetchFn: typeof fetch = fetch): Promise<number> {
    try {
      const r = await fetchFn('/api/assets');
      if (!r.ok) return 0;
      const list = (await r.json()) as { name: string; kind: string }[];
      const files: PxFile[] = [];
      for (const a of list) {
        if (a.kind !== 'sprites') continue;
        try {
          const f = await fetchFn('/api/assets/' + encodeURIComponent(a.name));
          if (f.ok) files.push((await f.json()) as PxFile);
        } catch { /* skip one bad file */ }
      }
      this.reset(files);
      return files.length;
    } catch { return 0; }
  }

  get(name: string): PxSprite | undefined { return this.sprites.get(name); }
  overlay(name: string): OverlaySprite | undefined { return this.overlays.get(name); }
  names(): string[] { return [...this.sprites.keys()]; }
  /** Sprites whose meta matches (e.g. { kind: 'deco' }). */
  where(meta: Record<string, unknown>): PxSprite[] {
    const out: PxSprite[] = [];
    for (const s of this.sprites.values()) if (Object.entries(meta).every(([k, v]) => s.meta?.[k] === v)) out.push(s);
    return out;
  }

  /** Rows of the frame shown at time t (seconds), honoring fps. */
  rows(s: PxSprite, t: number, frame?: number): string[] {
    const n = s.frames.length;
    const i = frame !== undefined ? Math.max(0, Math.min(n - 1, frame)) : s.fps ? Math.floor(t * s.fps) % n : 0;
    return s.frames[i]!;
  }

  /**
   * Draws `name` with its top-left at (x, y) minus the anchor (so x, y is the pivot).
   * Returns false when the sprite is missing (callers may fall back to procedural art).
   */
  draw(g: Painter, name: string, x: number, y: number, o: { t?: number; frame?: number; palette?: Record<string, string>; flip?: boolean; noAnchor?: boolean } = {}): boolean {
    const s = this.sprites.get(name);
    if (!s) return false;
    const pal = o.palette ? { ...s.palette, ...o.palette } : s.palette;
    const ax = o.noAnchor ? 0 : s.anchor?.[0] ?? 0, ay = o.noAnchor ? 0 : s.anchor?.[1] ?? 0;
    g.sprite(this.rows(s, o.t ?? 0, o.frame), x - ax, y - ay, pal, o.flip);
    return true;
  }

  /** Overlay points over a 10-wide character box at (x, y). */
  drawOverlay(g: Painter, name: string, view: 'front' | 'side' | 'back', x: number, y: number, pal: Record<string, string>, flip = false): void {
    const ov = this.overlays.get(name);
    if (!ov) return;
    for (const [cx, cy, k] of ov.views[view] ?? []) {
      const c = pal[k];
      if (c) g.px(x + (flip ? 9 - cx : cx), y + cy, c);
    }
  }
}
