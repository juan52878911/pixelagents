import type { OverlaySprite, PxFile, PxSprite } from '@pixelagents/protocol';
import { Rectangle, Texture } from 'pixi.js';
import { type AtlasItem, type Atlas, type SpriteSheet, type View, compileFrame, compositeOverlay, packAtlas } from './px.js';

export function textureFromRgba(data: Uint8ClampedArray, w: number, h: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  tex.source.autoGenerateMipmaps = false;
  return tex;
}

export function atlasToSheet(
  sprite: Pick<PxSprite, 'name' | 'w' | 'h' | 'anchor' | 'fps' | 'tags' | 'meta'>,
  atlas: Atlas, keys: string[], pad = 0,
): SpriteSheet {
  const base = textureFromRgba(atlas.data, atlas.width, atlas.height);
  const frames = keys.map((k) => {
    const r = atlas.rects.get(k)!;
    return new Texture({ source: base.source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
  });
  return {
    name: sprite.name, w: sprite.w + pad * 2, h: sprite.h + pad * 2,
    anchor: [(sprite.anchor?.[0] ?? 0) + pad, (sprite.anchor?.[1] ?? 0) + pad],
    fps: sprite.fps ?? 0, frames, tags: sprite.tags ?? {}, meta: sprite.meta ?? {},
  };
}

/** Registry of sprites + overlays, with cached palette variants (skins). */
export class SpriteLibrary {
  private sprites = new Map<string, PxSprite>();
  private overlays = new Map<string, OverlaySprite>();
  private cache = new Map<string, SpriteSheet>();
  private external = new Map<string, SpriteSheet>();
  version = 0;

  addFile(file: PxFile): void {
    for (const s of file.sprites) this.sprites.set(s.name, s);
    for (const o of file.overlays ?? []) this.overlays.set(o.name, o);
    this.invalidate();
  }
  addSheet(sheet: SpriteSheet): void { this.external.set(sheet.name, sheet); }
  has(name: string): boolean { return this.sprites.has(name) || this.external.has(name); }
  sprite(name: string): PxSprite | undefined { return this.sprites.get(name); }
  overlay(name: string): OverlaySprite | undefined { return this.overlays.get(name); }
  names(): string[] { return [...this.sprites.keys(), ...this.external.keys()]; }
  get variantCount(): number { return this.cache.size; }

  /** Drops cached textures (hot reload); callers re-`get` after `version` changes. */
  invalidate(): void {
    for (const s of this.cache.values()) s.frames[0]?.source.destroy();
    this.cache.clear();
    this.version++;
  }
  clear(): void { this.sprites.clear(); this.overlays.clear(); this.external.clear(); this.invalidate(); }

  /**
   * Sheet for `name` with optional palette override and accessory overlay, cached by variant.
   * Overlay variants are padded by 2px on every side, and `anchor` shifts accordingly.
   */
  get(name: string, opts: { palette?: Record<string, string>; overlay?: string; view?: View } = {}): SpriteSheet {
    const ext = this.external.get(name);
    if (ext) return ext;
    const sp = this.sprites.get(name);
    if (!sp) throw new Error(`px: unknown sprite "${name}"`);
    const key = `${name}|${opts.overlay ?? ''}|${opts.view ?? 'front'}|${opts.palette ? JSON.stringify(opts.palette) : ''}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const ov = opts.overlay ? this.overlays.get(opts.overlay) : undefined;
    if (opts.overlay && !ov) throw new Error(`px: unknown overlay "${opts.overlay}"`);
    const pad = ov ? 2 : 0;
    const merged = { ...sp.palette, ...opts.palette };
    const items: AtlasItem[] = sp.frames.map((_, i) => {
      let data = compileFrame(sp, i, opts.palette);
      let w = sp.w, h = sp.h;
      if (ov) ({ data, w, h } = compositeOverlay(data, w, h, ov, opts.view ?? 'front', merged, pad));
      return { key: String(i), w, h, data };
    });
    const sheet = atlasToSheet(sp, packAtlas(items), items.map((i) => i.key), pad);
    this.cache.set(key, sheet);
    return sheet;
  }
}

interface AseFrame { frame: { x: number; y: number; w: number; h: number }; duration: number; }
interface AseJson {
  frames: AseFrame[] | Record<string, AseFrame>;
  meta: { frameTags?: { name: string; from: number; to: number }[] };
}

/** Loads an Aseprite PNG + JSON (array or hash export) into a SpriteSheet registered in the library. */
export async function loadAseprite(lib: SpriteLibrary, name: string, pngUrl: string, jsonUrl: string, anchor: [number, number] = [0, 0]): Promise<SpriteSheet> {
  const [json, tex] = await Promise.all([
    fetch(jsonUrl).then((r) => r.json() as Promise<AseJson>),
    loadImageTexture(pngUrl),
  ]);
  const list = Array.isArray(json.frames) ? json.frames : Object.values(json.frames);
  const frames = list.map((f) => new Texture({ source: tex.source, frame: new Rectangle(f.frame.x, f.frame.y, f.frame.w, f.frame.h) }));
  const tags: Record<string, [number, number]> = {};
  for (const t of json.meta.frameTags ?? []) tags[t.name] = [t.from, t.to];
  const first = list[0]?.frame ?? { w: 0, h: 0 };
  const sheet: SpriteSheet = { name, w: first.w, h: first.h, anchor, fps: 0, frames, tags, meta: {}, durations: list.map((f) => f.duration) };
  lib.addSheet(sheet);
  return sheet;
}

async function loadImageTexture(url: string): Promise<Texture> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const tex = Texture.from(img);
  tex.source.scaleMode = 'nearest';
  return tex;
}

/** Fetches `.px.json` files and reloads the library from them (start-up and SSE `assets`). */
export async function loadPxUrls(lib: SpriteLibrary, urls: string[], fetchFn: typeof fetch = fetch): Promise<void> {
  const files = await Promise.all(urls.map(async (u) => {
    const r = await fetchFn(u);
    if (!r.ok) throw new Error(`px: ${u} → HTTP ${r.status}`);
    return (await r.json()) as PxFile;
  }));
  lib.clear();
  for (const f of files) lib.addFile(f);
}
