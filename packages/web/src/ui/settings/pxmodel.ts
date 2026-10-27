import type { OverlaySprite, PxFile, PxSprite } from '@pixelagents/protocol';

/** Pure model of the pixel editor: everything the grid does is a function on a PxSprite. */

const KEY = /^[^.\s]$/;
const COLOR = /^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}|rgba?\([^)]*\))$/;

export function newSprite(name: string, w = 16, h = 16): PxSprite {
  return {
    name, w, h,
    palette: { R: '#e4572e', Y: '#ffd166', G: '#4cc38a', B: '#3b7dd8', W: '#f2eadf', K: '#1b1620' },
    frames: [blankFrame(w, h)],
    fps: 0,
  };
}

export function blankFrame(w: number, h: number): string[] {
  return Array.from({ length: h }, () => '.'.repeat(w));
}

export function setPixel(s: PxSprite, frame: number, x: number, y: number, key: string): PxSprite {
  if (frame < 0 || frame >= s.frames.length || x < 0 || y < 0 || x >= s.w || y >= s.h) return s;
  if (key !== '.' && !(key in s.palette)) return s;
  const rows = s.frames[frame]!.slice();
  const row = rows[y]!;
  if (row[x] === key) return s;
  rows[y] = row.slice(0, x) + key + row.slice(x + 1);
  const frames = s.frames.slice();
  frames[frame] = rows;
  return { ...s, frames };
}

/** Flood fill of the contiguous region sharing the clicked pixel's key. */
export function fill(s: PxSprite, frame: number, x: number, y: number, key: string): PxSprite {
  const rows = s.frames[frame]?.map((r) => r.split(''));
  if (!rows || x < 0 || y < 0 || x >= s.w || y >= s.h) return s;
  const from = rows[y]![x]!;
  if (from === key || (key !== '.' && !(key in s.palette))) return s;
  const stack: [number, number][] = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h || rows[cy]![cx] !== from) continue;
    rows[cy]![cx] = key;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  const frames = s.frames.slice();
  frames[frame] = rows.map((r) => r.join(''));
  return { ...s, frames };
}

export function addFrame(s: PxSprite, copyOf?: number): PxSprite {
  const src = copyOf != null ? s.frames[copyOf] : undefined;
  return { ...s, frames: [...s.frames, src ? src.slice() : blankFrame(s.w, s.h)] };
}

export function removeFrame(s: PxSprite, i: number): PxSprite {
  if (s.frames.length <= 1) return s;
  return { ...s, frames: s.frames.filter((_, j) => j !== i) };
}

export function setPaletteColor(s: PxSprite, key: string, color: string): PxSprite {
  if (!KEY.test(key) || !COLOR.test(color)) return s;
  return { ...s, palette: { ...s.palette, [key]: color } };
}

export function removePaletteKey(s: PxSprite, key: string): PxSprite {
  if (!(key in s.palette)) return s;
  const { [key]: _gone, ...palette } = s.palette;
  const frames = s.frames.map((f) => f.map((r) => r.split(key).join('.')));
  return { ...s, palette, frames };
}

export function resize(s: PxSprite, w: number, h: number): PxSprite {
  const fit = (f: string[]): string[] => Array.from({ length: h }, (_, y) => (f[y] ?? '').slice(0, w).padEnd(w, '.'));
  return { ...s, w, h, frames: s.frames.map(fit) };
}

/** Problems that would make the file invalid (empty list = valid). */
export function validateSprite(s: PxSprite): string[] {
  const errs: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s.name)) errs.push('name must be letters, digits, dot, dash or underscore');
  if (!Number.isInteger(s.w) || !Number.isInteger(s.h) || s.w < 1 || s.h < 1 || s.w > 256 || s.h > 256) errs.push('size must be 1..256');
  if (!s.frames.length) errs.push('at least one frame');
  s.frames.forEach((f, i) => {
    if (f.length !== s.h) errs.push(`frame ${i + 1}: expected ${s.h} rows, got ${f.length}`);
    f.forEach((r, y) => {
      if (r.length !== s.w) errs.push(`frame ${i + 1} row ${y + 1}: expected width ${s.w}, got ${r.length}`);
      for (const ch of r) if (ch !== '.' && !(ch in s.palette)) { errs.push(`frame ${i + 1} row ${y + 1}: "${ch}" is not in the palette`); break; }
    });
  });
  for (const [k, c] of Object.entries(s.palette)) {
    if (!KEY.test(k)) errs.push(`palette key "${k}" must be one character other than "."`);
    if (!COLOR.test(c)) errs.push(`palette "${k}": bad color "${c}"`);
  }
  return errs;
}

/** Serialize to a valid `.px.json` document. Throws if the sprite is invalid. */
export function toPxFile(sprites: PxSprite | PxSprite[]): PxFile {
  const list = Array.isArray(sprites) ? sprites : [sprites];
  for (const s of list) {
    const errs = validateSprite(s);
    if (errs.length) throw new Error(`${s.name}: ${errs[0]}`);
  }
  return { px: 1, sprites: list.map((s) => {
    const out: PxSprite = { name: s.name, w: s.w, h: s.h, palette: { ...s.palette }, frames: s.frames.map((f) => f.slice()) };
    if (s.fps) out.fps = s.fps;
    if (s.anchor) out.anchor = s.anchor;
    if (s.tags) out.tags = s.tags;
    if (s.meta) out.meta = s.meta;
    return out;
  }) };
}

export function isPxFile(v: unknown): v is PxFile {
  const f = v as PxFile | null;
  return !!f && f.px === 1 && Array.isArray(f.sprites);
}

/** Paint one frame into a 2D context (nearest neighbour: one fillRect per pixel). */
export function drawSprite(ctx: CanvasRenderingContext2D | null, s: PxSprite, frame: number, scale: number, ox = 0, oy = 0): void {
  if (!ctx) return;
  const rows = s.frames[frame % Math.max(1, s.frames.length)] ?? [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const c = row[x]!;
      if (c === '.') continue;
      const col = s.palette[c];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

const OVERLAY_DEFAULTS: Record<string, string> = { A: '#3a3a4a', a: '#8f8fa6', C: '#e4572e', c: '#a63a1c', T: '#c0392b', W: '#f2eadf', H: '#2b1d16', S: '#f2c7a5', B: '#3b7dd8' };

/** Paint an accessory overlay (front view) over a plain 10×14 silhouette so it can be seen in a thumbnail. */
export function drawOverlay(ctx: CanvasRenderingContext2D | null, o: OverlaySprite, scale: number): void {
  if (!ctx) return;
  const view = o.views.front ?? o.views.side ?? o.views.back ?? [];
  ctx.fillStyle = '#4a4259';
  ctx.fillRect(2 * scale, 1 * scale, 6 * scale, 12 * scale);
  for (const [x, y, k] of view) {
    ctx.fillStyle = OVERLAY_DEFAULTS[k] ?? '#ffffff';
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }
}
