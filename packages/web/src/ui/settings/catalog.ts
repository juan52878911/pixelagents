import type { OverlaySprite, PxSprite } from '@pixelagents/protocol';
import type { Api, AssetInfo } from './api.js';
import { h } from './dom.js';
import { drawOverlay, drawSprite, isPxFile } from './pxmodel.js';

export interface CatalogSprite { sprite: PxSprite; file: string }
export interface CatalogOverlay { overlay: OverlaySprite; file: string }

/** Everything the server's asset folders offer, parsed once per (name,size) so pickers can show thumbnails. */
export class Catalog {
  sprites = new Map<string, CatalogSprite>();
  overlays = new Map<string, CatalogOverlay>();
  files: AssetInfo[] = [];
  pngs: AssetInfo[] = [];
  private cache = new Map<string, unknown>();

  async load(api: Api, files: AssetInfo[]): Promise<void> {
    this.files = files;
    this.pngs = files.filter((f) => f.kind === 'png');
    const sprites = new Map<string, CatalogSprite>();
    const overlays = new Map<string, CatalogOverlay>();
    await Promise.all(files.filter((f) => f.kind === 'sprites').map(async (f) => {
      const key = `${f.name}:${f.size}`;
      let doc = this.cache.get(key);
      if (doc === undefined) {
        doc = await api.getAsset(f.name).catch(() => null);
        this.cache.set(key, doc);
      }
      if (!isPxFile(doc)) return;
      for (const s of doc.sprites) sprites.set(s.name, { sprite: s, file: f.name });
      for (const o of doc.overlays ?? []) overlays.set(o.name, { overlay: o, file: f.name });
    }));
    this.sprites = sprites;
    this.overlays = overlays;
  }

  names(prefix: string): string[] {
    return [...this.sprites.keys(), ...this.overlays.keys()].filter((n) => n.startsWith(prefix)).sort();
  }

  /** A canvas thumbnail of a sprite or overlay, scaled to fit `box` pixels. */
  thumb(name: string, box = 32): HTMLCanvasElement {
    const c = h('canvas', { width: box, height: box, class: 'pa-thumb', 'aria-hidden': 'true' });
    const ctx = c.getContext('2d');
    const s = this.sprites.get(name)?.sprite;
    if (s) {
      const sc = Math.max(1, Math.floor(box / Math.max(s.w, s.h)));
      drawSprite(ctx, s, 0, sc, Math.floor((box - s.w * sc) / 2), Math.floor((box - s.h * sc) / 2));
      return c;
    }
    const o = this.overlays.get(name)?.overlay;
    if (o) drawOverlay(ctx, o, Math.max(1, Math.floor(box / 14)));
    return c;
  }
}
