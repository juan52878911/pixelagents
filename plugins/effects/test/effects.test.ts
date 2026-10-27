import { afterEach, describe, expect, it } from 'vitest';
import { FILTER_SPECS, PALETTES, daylight, parseHex, resolveParams } from '../src/client/specs.js';
import { filters } from '../src/client/index.js';
import effects from '../src/index.js';

const NAMES = ['crt', 'daynight', 'glow', 'scanlines', 'palette', 'outline'];

describe('catalogue', () => {
  it('has the six filters, each documented', () => {
    expect(Object.keys(FILTER_SPECS).sort()).toEqual([...NAMES].sort());
    for (const s of Object.values(FILTER_SPECS)) {
      expect(s.doc.length).toBeGreaterThan(10);
      for (const [k, p] of Object.entries(s.params)) expect(p.doc, `${s.name}.${k}`).toBeTruthy();
    }
  });

  it('defaults: resolveParams({}) returns the documented default of every parameter', () => {
    const d = (n: string) => resolveParams(FILTER_SPECS[n]!.params);
    expect(d('crt')).toEqual({ curvature: 0.12, scanlines: 0.18, period: 2, aberration: 0.0015, vignette: 0.35 });
    expect(d('daynight')).toEqual({ hour: -1, strength: 1, lightThreshold: 0.78, lightBoost: 1.25 });
    expect(d('glow')).toEqual({ threshold: 0.7, strength: 0.9, radius: 2.5 });
    expect(d('scanlines')).toEqual({ intensity: 0.22, period: 2, phase: 0 });
    expect(d('palette')).toEqual({ palette: 'prototype', colors: [], dither: 0 });
    expect(d('outline')).toEqual({ color: '#1a1423', thickness: 1, alpha: 1, diagonals: true });
  });

  it('bad values fall back to defaults and numbers are clamped', () => {
    const p = resolveParams(FILTER_SPECS.crt!.params, { curvature: 'lots', scanlines: 9, period: -3, aberration: NaN });
    expect(p).toMatchObject({ curvature: 0.12, scanlines: 1, period: 1, aberration: 0.0015 });
    expect(resolveParams(FILTER_SPECS.outline!.params, { color: 'nope', diagonals: 'yes' })).toMatchObject({ color: '#1a1423', diagonals: true });
    expect(resolveParams(FILTER_SPECS.palette!.params, { colors: ['#000000'] }).colors).toEqual([]);
  });

  it('every uniform the shader declares is provided, and nothing else', () => {
    for (const s of Object.values(FILTER_SPECS)) {
      const p = resolveParams(s.params);
      const frag = s.fragment(p);
      const declared = [...frag.matchAll(/uniform float (\w+);/g)].map((m) => m[1]!).sort();
      expect(Object.keys(s.uniforms(p)).sort(), s.name).toEqual(declared);
      expect(frag).toContain('void main');
      // The engine compiles GLSL as WebGL1-compatible: no const arrays.
      expect(frag, s.name).not.toMatch(/\w\[\d*\]\s*(=|\()/);
    }
  });

  it('palettes: gameboy 4 colours, pico8 16, prototype from POP_C; palette shader embeds them', () => {
    expect(PALETTES.gameboy).toHaveLength(4);
    expect(PALETTES.pico8).toHaveLength(16);
    expect(PALETTES.prototype!.length).toBeGreaterThan(16);
    for (const c of Object.values(PALETTES).flat()) expect(parseHex(c), c).not.toBeNull();
    const frag = FILTER_SPECS.palette!.fragment(resolveParams(FILTER_SPECS.palette!.params, { palette: 'gameboy' }));
    expect(frag.match(/if \(dd < bd\)/g)).toHaveLength(4);
    const custom = FILTER_SPECS.palette!.fragment(resolveParams(FILTER_SPECS.palette!.params, { colors: ['#000', '#fff'] }));
    expect(custom.match(/if \(dd < bd\)/g)).toHaveLength(2);
  });

  it('daylight: neutral from 8h, blue and dark-lit at midnight, warm at dusk', () => {
    const noon = daylight(8);
    expect(noon.tint).toEqual([1, 1, 1]);
    expect(noon.night).toBe(0);
    expect(daylight(12).night).toBe(0);
    const mid = daylight(0);
    expect(mid.night).toBe(1);
    expect(mid.tint[2]).toBeGreaterThan(mid.tint[0]);
    const dusk = daylight(18.5);
    expect(dusk.tint[0]).toBeGreaterThan(dusk.tint[2]);
    expect(daylight(24 + 8)).toEqual(noon);
    expect(daylight(-16)).toEqual(noon);
  });

  it('daynight with a forced hour does not depend on the clock', () => {
    const p = resolveParams(FILTER_SPECS.daynight!.params, { hour: 8 });
    expect(FILTER_SPECS.daynight!.uniforms(p)).toMatchObject({ uTR: 1, uTG: 1, uTB: 1, uNight: 0 });
    const n = FILTER_SPECS.daynight!.uniforms(resolveParams(FILTER_SPECS.daynight!.params, { hour: 23 }));
    expect(n.uNight).toBe(1);
    expect(n.uTB).toBeGreaterThan(n.uTR!);
  });
});

describe('server plugin', () => {
  it('points clientEntry at dist/client.js', () => {
    expect(effects.name).toBe('effects');
    expect(effects.clientEntry).toMatch(/plugins\/effects\/dist\/client\.js$/);
  });
});

// ---- factories against a mock of pixi ----

interface Made { fragment: string; vertex: string; name: string; uniforms: Record<string, { value: number }> }
function installMockPixi(): Made[] {
  const made: Made[] = [];
  class UniformGroup { constructor(public uniforms: Record<string, { value: number }>) {} }
  class Filter {
    resources: Record<string, unknown>;
    glProgram: { vertex: string; fragment: string; name: string };
    constructor(o: { glProgram: Filter['glProgram']; resources: Record<string, unknown> }) {
      this.resources = o.resources; this.glProgram = o.glProgram;
      made.push({ ...o.glProgram, uniforms: (o.resources.pxUniforms as UniformGroup).uniforms });
    }
    destroy(): void {}
  }
  (globalThis as Record<string, unknown>).__pixelagents = { pixi: { Filter, UniformGroup, GlProgram: { from: (o: unknown) => o } } };
  return made;
}

describe('client factories', () => {
  afterEach(() => { delete (globalThis as Record<string, unknown>).__pixelagents; });

  it('exposes one factory per filter', () => {
    expect(Object.keys(filters).sort()).toEqual([...NAMES].sort());
  });

  it('each factory builds a program with the default uniforms and a main()', () => {
    const made = installMockPixi();
    for (const n of NAMES) {
      const before = made.length;
      const f = filters[n]!(n === 'daynight' ? { hour: 8 } : {});
      expect(f, n).toBeTruthy();
      expect(made.length).toBe(before + 1);
      const m = made.at(-1)!;
      expect(m.name).toBe(n);
      expect(m.fragment).toContain('precision highp float');
      expect(m.fragment).toContain('void main');
      expect(m.vertex).toContain('filterTextureCoord');
      for (const u of Object.values(m.uniforms)) expect(Number.isFinite(u.value)).toBe(true);
    }
    // user params reach the uniforms
    const f2 = filters.glow!({ strength: 2 });
    expect(f2).toBeTruthy();
    expect(made.at(-1)!.uniforms.uStr!.value).toBe(2);
  });

  it('daynight without hour refreshes on a timer that destroy() stops', () => {
    installMockPixi();
    const f = filters.daynight!({});
    expect(f).toBeTruthy();
    expect(() => f!.destroy()).not.toThrow();
  });

  it('fails with a clear message when the host did not expose pixi', () => {
    expect(() => filters.crt!({})).toThrow(/__pixelagents/);
  });
});
