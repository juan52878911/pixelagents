import type { OverlaySprite, PxSprite } from '@pixelagents/protocol';
import { describe, expect, it } from 'vitest';
import { compileFrame, compositeOverlay, frameAt, packAtlas, parseColor } from '../src/engine/px.js';

const sprite: PxSprite = {
  name: 't', w: 3, h: 2, palette: { A: '#ff0000', B: 'rgba(0,255,0,0.5)', C: '#00f' },
  frames: [['A.B', 'C.A'], ['AAA', '...']], fps: 4, tags: { x: [1, 1] },
};

describe('compileFrame', () => {
  it('maps palette keys to RGBA and leaves "." transparent', () => {
    const d = compileFrame(sprite, 0);
    expect(d.length).toBe(3 * 2 * 4);
    expect([...d.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...d.subarray(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...d.subarray(8, 12)]).toEqual([0, 255, 0, 128]); // rgba alpha
    expect([...d.subarray(12, 16)]).toEqual([0, 0, 255, 255]); // #rgb shorthand
  });
  it('applies a palette override per key', () => {
    const d = compileFrame(sprite, 0, { A: '#102030' });
    expect([...d.subarray(0, 4)]).toEqual([0x10, 0x20, 0x30, 255]);
    expect([...d.subarray(20, 24)]).toEqual([0x10, 0x20, 0x30, 255]);
    expect([...d.subarray(12, 16)]).toEqual([0, 0, 255, 255]); // untouched
  });
  it('throws when a row has the wrong width', () => {
    const bad = { ...sprite, frames: [['AA', 'C.A']] };
    expect(() => compileFrame(bad, 0)).toThrow(/row 0 is 2 wide, expected 3/);
  });
  it('throws when the frame has the wrong number of rows', () => {
    expect(() => compileFrame({ ...sprite, frames: [['A.B']] }, 0)).toThrow(/1 rows, expected 2/);
  });
  it('throws when a palette key is missing', () => {
    expect(() => compileFrame({ ...sprite, frames: [['AZB', 'C.A']] }, 0)).toThrow(/key "Z"/);
  });
  it('throws on unknown frame', () => {
    expect(() => compileFrame(sprite, 5)).toThrow(/no frame 5/);
  });
});

describe('parseColor', () => {
  it('parses hex forms and rejects garbage', () => {
    expect(parseColor('#abc')).toEqual([170, 187, 204, 255]);
    expect(parseColor('#11223344')).toEqual([0x11, 0x22, 0x33, 0x44]);
    expect(parseColor('rgb(1,2,3)')).toEqual([1, 2, 3, 255]);
    expect(() => parseColor('red')).toThrow();
    expect(() => parseColor('#12')).toThrow();
  });
});

describe('compositeOverlay', () => {
  const ov: OverlaySprite = { name: 'o', views: { front: [[0, 0, 'A'], [1, -1, 'C']], side: [[2, 1, 'A']] } };
  it('draws over the base, padded, negative coords allowed', () => {
    const base = compileFrame(sprite, 1); // row0 red, row1 transparent
    const out = compositeOverlay(base, 3, 2, ov, 'front', { A: '#000001', C: '#00ff00' }, 2);
    expect(out.w).toBe(7); expect(out.h).toBe(6);
    const at = (x: number, y: number) => [...out.data.subarray((y * out.w + x) * 4, (y * out.w + x) * 4 + 4)];
    expect(at(2, 2)).toEqual([0, 0, 1, 255]); // overlay replaced base red at (0,0)
    expect(at(3, 2)).toEqual([255, 0, 0, 255]); // base preserved
    expect(at(3, 1)).toEqual([0, 255, 0, 255]); // y=-1 inside padding
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
  });
  it('uses the palette of the skin and errors on missing keys', () => {
    const base = compileFrame(sprite, 1);
    expect(() => compositeOverlay(base, 3, 2, ov, 'front', { A: '#000' })).toThrow(/key "C"/);
  });
  it('ignores views the overlay does not define', () => {
    const base = compileFrame(sprite, 1);
    const out = compositeOverlay(base, 3, 2, ov, 'back', {}, 1);
    expect(out.w).toBe(5);
  });
});

describe('packAtlas', () => {
  const item = (key: string, w: number, h: number, v: number) => ({ key, w, h, data: new Uint8ClampedArray(w * h * 4).fill(v) });
  it('packs without overlap and copies pixels to the right place', () => {
    const items = [item('a', 10, 14, 1), item('b', 10, 14, 2), item('c', 4, 4, 3), item('d', 30, 5, 4)];
    const atlas = packAtlas(items);
    const rs = [...atlas.rects.entries()];
    for (const [k, r] of rs) {
      expect(r.x + r.w).toBeLessThanOrEqual(atlas.width);
      expect(r.y + r.h).toBeLessThanOrEqual(atlas.height);
      const v = items.find((i) => i.key === k)!.data[0];
      expect(atlas.data[(r.y * atlas.width + r.x) * 4]).toBe(v);
      expect(atlas.data[((r.y + r.h - 1) * atlas.width + r.x + r.w - 1) * 4]).toBe(v);
    }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]![1], b = rs[j]![1];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap).toBe(false);
    }
  });
  it('grows to fit a wide item and rejects impossible ones', () => {
    expect(packAtlas([item('w', 100, 2, 1)]).width).toBeGreaterThanOrEqual(100);
    expect(() => packAtlas([item('w', 5000, 2, 1)])).toThrow(/wider/);
  });
});

describe('frameAt', () => {
  const sheet = { fps: 10, frames: [0, 1, 2, 3, 4] as never[], tags: { walk: [1, 3] as [number, number] } };
  it('loops over the whole sprite or inside a tag', () => {
    expect(frameAt(sheet, 0)).toBe(0);
    expect(frameAt(sheet, 150)).toBe(1);
    expect(frameAt(sheet, 500)).toBe(0);
    expect(frameAt(sheet, 0, 'walk')).toBe(1);
    expect(frameAt(sheet, 250, 'walk')).toBe(3);
    expect(frameAt(sheet, 300, 'walk')).toBe(1);
  });
  it('is static with fps 0 and honours Aseprite durations', () => {
    expect(frameAt({ ...sheet, fps: 0 }, 9999)).toBe(0);
    const ase = { fps: 0, frames: [0, 1] as never[], tags: {}, durations: [100, 300] };
    expect(frameAt(ase, 50)).toBe(0);
    expect(frameAt(ase, 150)).toBe(1);
    expect(frameAt(ase, 420)).toBe(0);
  });
});
