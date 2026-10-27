/**
 * Filter catalogue of the effects plugin: pure data and GLSL, no pixi import, so it can be unit-tested
 * in node. Every filter declares its parameters (type, default, range, doc); `resolveParams` turns
 * whatever the user wrote in `config.effects[].params` into a complete, clamped set.
 */

export type ParamType = 'number' | 'boolean' | 'color' | 'string' | 'colors';
export interface ParamSpec {
  type: ParamType;
  default: number | boolean | string | string[];
  min?: number;
  max?: number;
  doc: string;
}
export type Resolved = Record<string, number | boolean | string | string[]>;

export interface FilterSpec {
  name: string;
  doc: string;
  /** Layers where it makes sense (informative). */
  layers: string[];
  params: Record<string, ParamSpec>;
  /** Fragment shader (GLSL ES 3.00 body without `#version`/precision; the helper adds them). */
  fragment(p: Resolved): string;
  /** Float uniforms for the shader. */
  uniforms(p: Resolved): Record<string, number>;
}

export const HEADER = `in vec2 vTextureCoord; out vec4 finalColor;
uniform sampler2D uTexture; uniform vec4 uInputSize;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

// ---------- param helpers ----------

export function parseHex(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function resolveParams(specs: Record<string, ParamSpec>, input: Record<string, unknown> = {}): Resolved {
  const out: Resolved = {};
  for (const [k, s] of Object.entries(specs)) {
    const v = input[k];
    switch (s.type) {
      case 'number': {
        let n = typeof v === 'number' && Number.isFinite(v) ? v : (s.default as number);
        if (s.min !== undefined) n = Math.max(s.min, n);
        if (s.max !== undefined) n = Math.min(s.max, n);
        out[k] = n;
        break;
      }
      case 'boolean': out[k] = typeof v === 'boolean' ? v : (s.default as boolean); break;
      case 'color': out[k] = typeof v === 'string' && parseHex(v) ? v : (s.default as string); break;
      case 'string': out[k] = typeof v === 'string' ? v : (s.default as string); break;
      case 'colors': out[k] = Array.isArray(v) && v.length > 1 && v.every((x) => typeof x === 'string' && parseHex(x)) ? (v as string[]) : (s.default as string[]); break;
    }
  }
  return out;
}

const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const rgb = (hex: string): [number, number, number] => parseHex(hex) ?? [0, 0, 0];

// ---------- palettes ----------

export const PALETTES: Record<string, string[]> = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  // The colours of the prototype's pop art (POP_C) plus its outline ink.
  prototype: ['#1a1423', '#100e16', '#3b3346', '#5b5470', '#8f96a3', '#e9f2f7', '#fff6c9', '#f5e6c8', '#6b4329', '#a8744c', '#c9a06a', '#a8322a', '#e5533d', '#ff9d8a', '#f0802a', '#ffd23f', '#f5c542', '#2e8a5e', '#4cc38a', '#7ee787', '#3fb8d8', '#5ad1e6', '#4a90e2', '#79c0ff', '#d64fa0', '#d2a8ff'],
};

export function paletteColors(p: Resolved): string[] {
  if (Array.isArray(p.colors) && p.colors.length) return p.colors;
  return PALETTES[String(p.palette)] ?? PALETTES.prototype!;
}

// ---------- daylight curve ----------

/** [hour, r, g, b, night] keyframes: multiply tint and how "night" it is (0 day … 1 night). */
const DAY: number[][] = [
  [0, 0.34, 0.42, 0.75, 1],
  [5, 0.42, 0.48, 0.8, 0.95],
  [6.5, 1.0, 0.74, 0.62, 0.45],
  [8, 1, 1, 1, 0],
  [17, 1, 0.97, 0.9, 0],
  [18.5, 1.0, 0.64, 0.44, 0.4],
  [20, 0.5, 0.44, 0.74, 0.88],
  [21.5, 0.34, 0.42, 0.75, 1],
  [24, 0.34, 0.42, 0.75, 1],
];

/** Tint and night factor for a (fractional) hour 0..24. */
export function daylight(hour: number): { tint: [number, number, number]; night: number } {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < DAY.length - 2 && h >= DAY[i + 1]![0]!) i++;
  const a = DAY[i]!, b = DAY[i + 1]!;
  const t = (h - a[0]!) / (b[0]! - a[0]!);
  const m = (k: number): number => a[k]! + (b[k]! - a[k]!) * t;
  return { tint: [m(1), m(2), m(3)], night: m(4) };
}

export function localHour(d: Date = new Date()): number { return d.getHours() + d.getMinutes() / 60; }

// ---------- the filters ----------

export const FILTER_SPECS: Record<string, FilterSpec> = {
  crt: {
    name: 'crt',
    doc: 'Old CRT monitor: soft screen curvature, scanlines, RGB fringing at the edges and a vignette.',
    layers: ['screen', 'world'],
    params: {
      curvature: { type: 'number', default: 0.12, min: 0, max: 0.5, doc: 'Barrel distortion (0 = flat).' },
      scanlines: { type: 'number', default: 0.18, min: 0, max: 1, doc: 'Darkness of the scanlines.' },
      period: { type: 'number', default: 2, min: 1, max: 8, doc: 'Scanline period in source pixels.' },
      aberration: { type: 'number', default: 0.0015, min: 0, max: 0.02, doc: 'Red/blue channel shift at the edges (fraction of width).' },
      vignette: { type: 'number', default: 0.35, min: 0, max: 1, doc: 'Corner darkening.' },
    },
    uniforms: (p) => ({ uCurve: p.curvature as number, uScan: p.scanlines as number, uPeriod: p.period as number, uAber: p.aberration as number, uVig: p.vignette as number }),
    fragment: () => `${HEADER}
uniform float uCurve; uniform float uScan; uniform float uPeriod; uniform float uAber; uniform float uVig;
void main(void){
  vec2 uv = vTextureCoord * 2.0 - 1.0;
  vec2 w = uv * (1.0 + dot(uv, uv) * uCurve);
  vec2 q = w * 0.5 + 0.5;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) { finalColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float shift = uAber * dot(w, w);
  vec4 c = texture(uTexture, q);
  float r = texture(uTexture, vec2(q.x + shift, q.y)).r;
  float b = texture(uTexture, vec2(q.x - shift, q.y)).b;
  vec3 col = vec3(r, c.g, b);
  float row = floor(q.y * uInputSize.y);
  float line = step(uPeriod * 0.5, mod(row, uPeriod));
  col *= 1.0 - uScan * line;
  col *= 1.0 - uVig * clamp(dot(w, w) * 0.5, 0.0, 1.0);
  finalColor = vec4(col, 1.0);
}`,
  },

  daynight: {
    name: 'daynight',
    doc: 'Time-of-day grade: multiplicative tint for dawn, day, dusk and night. At night very bright pixels (windows, lamps, fire) keep glowing.',
    layers: ['world', 'actors'],
    params: {
      hour: { type: 'number', default: -1, min: -1, max: 24, doc: 'Forced hour 0..24 (fractions allowed). -1 = the local hour, refreshed every minute.' },
      strength: { type: 'number', default: 1, min: 0, max: 1.5, doc: 'How much of the tint is applied (0 = off).' },
      lightThreshold: { type: 'number', default: 0.78, min: 0, max: 1, doc: 'Brightness (max of luma and 0.85 x the strongest channel) above which a pixel counts as a light.' },
      lightBoost: { type: 'number', default: 1.25, min: 1, max: 3, doc: 'Brightness multiplier of lights at full night.' },
    },
    uniforms: (p) => {
      const h = (p.hour as number) < 0 ? localHour() : (p.hour as number);
      const d = daylight(h);
      const s = p.strength as number;
      return {
        uTR: 1 + (d.tint[0] - 1) * s, uTG: 1 + (d.tint[1] - 1) * s, uTB: 1 + (d.tint[2] - 1) * s,
        uNight: Math.min(1, d.night * s), uThr: p.lightThreshold as number, uBoost: p.lightBoost as number,
      };
    },
    fragment: () => `${HEADER}
uniform float uTR; uniform float uTG; uniform float uTB; uniform float uNight; uniform float uThr; uniform float uBoost;
void main(void){
  vec4 c = texture(uTexture, vTextureCoord);
  float a = max(c.a, 0.0001);
  vec3 base = c.rgb / a;
  vec3 tinted = base * vec3(uTR, uTG, uTB);
  float bright = max(luma(base), 0.85 * max(base.r, max(base.g, base.b)));
  float light = smoothstep(uThr, min(1.0, uThr + 0.12), bright) * uNight;
  vec3 lit = mix(tinted, min(base * uBoost, vec3(1.0)), light);
  finalColor = vec4(lit * a, c.a);
}`,
  },

  glow: {
    name: 'glow',
    doc: 'Cheap bloom: bright pixels (above a threshold) bleed light into their neighbours. Meant for fire, screens and lamps.',
    layers: ['world', 'actors', 'screen'],
    params: {
      threshold: { type: 'number', default: 0.7, min: 0, max: 0.99, doc: 'Luma above which a pixel glows.' },
      strength: { type: 'number', default: 0.9, min: 0, max: 4, doc: 'Intensity of the added light.' },
      radius: { type: 'number', default: 2.5, min: 0.5, max: 8, doc: 'Spread in source pixels.' },
    },
    uniforms: (p) => ({ uThr: p.threshold as number, uStr: p.strength as number, uRad: p.radius as number }),
    fragment: () => `${HEADER}
uniform float uThr; uniform float uStr; uniform float uRad;
void main(void){
  vec4 c = texture(uTexture, vTextureCoord);
  vec3 acc = vec3(0.0);
  for (int ring = 1; ring <= 2; ring++) {
    float rr = uRad * float(ring) * 0.5;
    for (int i = 0; i < 8; i++) {
      float ang = float(i) * 0.7853982;
      vec2 o = vec2(cos(ang), sin(ang)) * rr * uInputSize.zw;
      vec4 s = texture(uTexture, vTextureCoord + o);
      float k = max(luma(s.rgb) - uThr, 0.0) / max(1.0 - uThr, 0.01);
      acc += s.rgb * k;
    }
  }
  acc /= 16.0;
  finalColor = vec4(c.rgb + acc * uStr, max(c.a, min(1.0, luma(acc) * uStr)));
}`,
  },

  scanlines: {
    name: 'scanlines',
    doc: 'Horizontal dark lines only (no curvature): a lighter alternative to crt.',
    layers: ['screen', 'world'],
    params: {
      intensity: { type: 'number', default: 0.22, min: 0, max: 1, doc: 'Darkness of the lines.' },
      period: { type: 'number', default: 2, min: 1, max: 8, doc: 'Distance between lines in source pixels.' },
      phase: { type: 'number', default: 0, min: 0, max: 8, doc: 'Offset of the pattern in source pixels.' },
    },
    uniforms: (p) => ({ uInt: p.intensity as number, uPeriod: p.period as number, uPhase: p.phase as number }),
    fragment: () => `${HEADER}
uniform float uInt; uniform float uPeriod; uniform float uPhase;
void main(void){
  vec4 c = texture(uTexture, vTextureCoord);
  float row = floor(vTextureCoord.y * uInputSize.y + uPhase);
  float line = step(uPeriod * 0.5, mod(row, uPeriod));
  finalColor = vec4(c.rgb * (1.0 - uInt * line), c.a);
}`,
  },

  palette: {
    name: 'palette',
    doc: 'Quantises every pixel to the nearest colour of a palette (gameboy, pico8, prototype, or your own list).',
    layers: ['screen', 'world', 'actors'],
    params: {
      palette: { type: 'string', default: 'prototype', doc: `Named palette: ${Object.keys(PALETTES).join(', ')}.` },
      colors: { type: 'colors', default: [], doc: 'Custom list of "#rrggbb" (overrides `palette` when it has 2+ colours).' },
      dither: { type: 'number', default: 0, min: 0, max: 1, doc: 'Ordered 4x4 dithering amount (0 = none).' },
    },
    uniforms: (p) => ({ uDither: p.dither as number }),
    fragment: (p) => {
      const cols = paletteColors(p);
      // Unrolled on purpose: the engine compiles GLSL as WebGL1-compatible (no const arrays).
      const tests = cols.map((c) => {
        const [r, g, b] = rgb(c);
        const v = `vec3(${f(+r.toFixed(4))}, ${f(+g.toFixed(4))}, ${f(+b.toFixed(4))})`;
        return `  d = col - ${v}; dd = dot(d, d); if (dd < bd) { bd = dd; best = ${v}; }`;
      });
      return `${HEADER}
uniform float uDither;
float bayer(vec2 p){
  vec2 m = mod(floor(p), 4.0);
  float i = m.x + m.y * 4.0;
  return mod(i * 7.0, 16.0) / 16.0 - 0.5;
}
void main(void){
  vec4 c = texture(uTexture, vTextureCoord);
  float a = max(c.a, 0.0001);
  vec3 col = c.rgb / a;
  col += bayer(vTextureCoord * uInputSize.xy) * uDither * 0.25;
  vec3 best = vec3(0.0); float bd = 1e9; vec3 d; float dd;
${tests.join('\n')}
  finalColor = vec4(best * c.a, c.a);
}`;
    },
  },

  outline: {
    name: 'outline',
    doc: 'Draws a 1+ pixel contour around the opaque shapes of the layer. Best on `actors`.',
    layers: ['actors', 'world'],
    params: {
      color: { type: 'color', default: '#1a1423', doc: 'Contour colour.' },
      thickness: { type: 'number', default: 1, min: 1, max: 4, doc: 'Contour width in source pixels.' },
      alpha: { type: 'number', default: 1, min: 0, max: 1, doc: 'Contour opacity.' },
      diagonals: { type: 'boolean', default: true, doc: 'Also look at diagonal neighbours (rounder, thicker corners).' },
    },
    uniforms: (p) => {
      const [r, g, b] = rgb(p.color as string);
      return { uR: r, uG: g, uB: b, uA: p.alpha as number, uT: p.thickness as number, uDiag: p.diagonals ? 1 : 0 };
    },
    fragment: () => `${HEADER}
uniform float uR; uniform float uG; uniform float uB; uniform float uA; uniform float uT; uniform float uDiag;
void main(void){
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 d = uInputSize.zw * uT;
  float n = 0.0;
  n = max(n, texture(uTexture, vTextureCoord + vec2(d.x, 0.0)).a);
  n = max(n, texture(uTexture, vTextureCoord - vec2(d.x, 0.0)).a);
  n = max(n, texture(uTexture, vTextureCoord + vec2(0.0, d.y)).a);
  n = max(n, texture(uTexture, vTextureCoord - vec2(0.0, d.y)).a);
  if (uDiag > 0.5) {
    n = max(n, texture(uTexture, vTextureCoord + d).a);
    n = max(n, texture(uTexture, vTextureCoord - d).a);
    n = max(n, texture(uTexture, vTextureCoord + vec2(d.x, -d.y)).a);
    n = max(n, texture(uTexture, vTextureCoord + vec2(-d.x, d.y)).a);
  }
  float ao = (1.0 - c.a) * step(0.5, n) * uA;
  finalColor = c + vec4(vec3(uR, uG, uB) * ao, ao);
}`,
  },
};
