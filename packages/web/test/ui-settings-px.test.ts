// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SpriteLibrary } from '../src/engine/library.js';
import { addFrame, fill, newSprite, removeFrame, removePaletteKey, resize, setPaletteColor, setPixel, toPxFile, validateSprite } from '../src/ui/settings/pxmodel.js';

describe('pixel editor model', () => {
  it('serializes to a valid PxFile', () => {
    let s = newSprite('my.sprite', 4, 3);
    s = setPixel(s, 0, 1, 1, 'R');
    s = addFrame(s, 0);
    s = setPixel(s, 1, 2, 2, 'Y');
    s = { ...s, fps: 4 };
    const f = toPxFile(s);
    expect(f.px).toBe(1);
    expect(f.sprites).toHaveLength(1);
    expect(f.sprites[0]).toMatchObject({ name: 'my.sprite', w: 4, h: 3, fps: 4 });
    expect(f.sprites[0]!.frames[0]).toEqual(['....', '.R..', '....']);
    expect(f.sprites[0]!.frames[1]).toEqual(['....', '.R..', '..Y.']);
    expect(JSON.parse(JSON.stringify(f))).toEqual(f);
    for (const fr of f.sprites[0]!.frames) { expect(fr).toHaveLength(3); for (const r of fr) expect(r).toHaveLength(4); }
  });

  it('is accepted by the engine sprite library', () => {
    let s = newSprite('t.one', 5, 5);
    s = fill(s, 0, 0, 0, 'G');
    const lib = new SpriteLibrary();
    expect(() => lib.addFile(toPxFile(s))).not.toThrow();
    expect(lib.has('t.one')).toBe(true);
  });

  it('refuses to serialize invalid sprites', () => {
    const s = newSprite('bad name!', 4, 4);
    expect(validateSprite(s).length).toBeGreaterThan(0);
    expect(() => toPxFile(s)).toThrow();
    const t = { ...newSprite('ok', 3, 3), frames: ['..Z', '...', '...'].length ? [['..Z', '...', '...']] : [] };
    expect(validateSprite(t).join()).toContain('"Z"');
  });

  it('ignores out-of-range or unknown-key paints and edits the palette safely', () => {
    const s = newSprite('x', 3, 3);
    expect(setPixel(s, 0, 9, 9, 'R')).toBe(s);
    expect(setPixel(s, 0, 0, 0, 'Q')).toBe(s);
    expect(setPaletteColor(s, 'Q', 'red')).toBe(s);
    const s2 = setPaletteColor(s, 'Q', '#123456');
    expect(setPixel(s2, 0, 0, 0, 'Q').frames[0]![0]).toBe('Q..');
    const s3 = removePaletteKey(setPixel(s2, 0, 0, 0, 'Q'), 'Q');
    expect(s3.frames[0]![0]).toBe('...');
    expect(validateSprite(s3)).toEqual([]);
  });

  it('keeps at least one frame and resizes without breaking rows', () => {
    let s = newSprite('x', 3, 3);
    expect(removeFrame(s, 0).frames).toHaveLength(1);
    s = resize(setPixel(s, 0, 2, 2, 'R'), 5, 2);
    expect(s.frames[0]).toEqual(['.....', '.....']);
    expect(validateSprite(s)).toEqual([]);
  });
});
