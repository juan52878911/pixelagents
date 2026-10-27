// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CACHE_OPTS, Engine } from '../src/engine/engine.js';
import { FONT_3x5, FONT_4x6, FONT_5x7, fit, measure } from '../src/engine/fonts.js';
import { BufferPainter } from '../src/engine/painter.js';

describe('pixel-perfect world layer', () => {
  it('caches layers with nearest sampling (Pixi defaults cacheAsTexture to linear → blur on zoom)', () => {
    expect(CACHE_OPTS.scaleMode).toBe('nearest');
    expect(CACHE_OPTS.resolution).toBe(1);
    expect(CACHE_OPTS.antialias).toBe(false);
    // cacheLayer passes exactly those options to the layer container (no renderer needed)
    const calls: unknown[] = [];
    const e = new Engine();
    (e.layers as Record<string, unknown>).world = { cacheAsTexture: (o: unknown) => calls.push(o), updateCacheTexture: () => calls.push('update') };
    e.cacheLayer('world', true);
    e.cacheLayer('world', false);
    expect(calls).toEqual([CACHE_OPTS, 'update', false]);
  });
});

describe('bitmap fonts', () => {
  it('every glyph has the font height and a consistent row width', () => {
    for (const f of [FONT_3x5, FONT_4x6, FONT_5x7]) {
      for (const [ch, rows] of Object.entries(f.glyphs)) {
        expect(rows, `${f.name} ${ch}`).toHaveLength(f.height);
        for (const r of rows) { expect(r, `${f.name} ${ch}`).toHaveLength(rows[0]!.length); expect(r).toMatch(/^[#.]+$/); }
      }
      for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .:-/!?·…') expect(f.glyphs[ch], `${f.name} ${ch}`).toBeDefined();
    }
  });
  it('measures, strips diacritics and never overflows when fitted', () => {
    expect(measure('AB', FONT_3x5)).toBe(7);
    expect(measure('ab', FONT_3x5)).toBe(7);
    expect(measure('É', FONT_5x7)).toBe(measure('E', FONT_5x7));
    expect(measure('', FONT_4x6)).toBe(0);
    for (const f of [FONT_3x5, FONT_4x6, FONT_5x7]) {
      for (const s of ['VIBEVOICENIX', 'mac-studio-de-juan', 'X', 'un nombre muy largo de repositorio']) {
        for (const maxW of [3, 8, 20, 34, 60, 200]) {
          const t = fit(s, maxW, f);
          expect(measure(t, f), `${f.name} "${s}" in ${maxW}`).toBeLessThanOrEqual(maxW);
          if (measure(s, f) <= maxW) expect(t).toBe(s); else if (t) expect(t.endsWith('…')).toBe(true);
        }
      }
    }
  });
  it('draws through the painter with the chosen font', () => {
    const p = new BufferPainter(32, 16);
    p.text('I', 0, 0, '#ffffff', 1, FONT_5x7);
    const at = (x: number, y: number) => p.data[(y * 32 + x) * 4 + 3];
    expect(at(0, 0)).toBe(255); expect(at(1, 3)).toBe(255); expect(at(0, 3)).toBe(0); expect(at(0, 6)).toBe(255);
  });
});
