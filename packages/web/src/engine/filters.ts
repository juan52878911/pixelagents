import type { EffectConfig } from '@pixelagents/protocol';
import { Filter, GlProgram, UniformGroup } from 'pixi.js';

export type LayerName = 'world' | 'actors' | 'ui' | 'screen';
/** Returns a pixi Filter, or null for "no filter" (the `none` path). */
export type FilterFactory = (params: Record<string, unknown>) => Filter | null;

const registry = new Map<string, FilterFactory>();

export function registerFilter(name: string, factory: FilterFactory): void { registry.set(name, factory); }
export function hasFilter(name: string): boolean { return registry.has(name); }
export function filterNames(): string[] { return [...registry.keys()]; }

export function createFilter(name: string, params: Record<string, unknown> = {}): Filter | null {
  const f = registry.get(name);
  if (!f) throw new Error(`filters: unknown filter "${name}"`);
  return f(params);
}

/** Builds the filter list per layer from `config.effects` (disabled and unknown ones are skipped). */
export function buildEffects(effects: EffectConfig[], onUnknown?: (name: string) => void): Record<LayerName, Filter[]> {
  const out: Record<LayerName, Filter[]> = { world: [], actors: [], ui: [], screen: [] };
  for (const fx of effects) {
    if (fx.enabled === false) continue;
    if (!registry.has(fx.filter)) { onUnknown?.(fx.filter); continue; }
    const layer = fx.layer as LayerName;
    if (!(layer in out)) continue;
    const f = createFilter(fx.filter, fx.params ?? {});
    if (f) out[layer].push(f);
  }
  return out;
}

// Same vertex as pixi's default filter vertex (not exported publicly).
export const FILTER_VERT = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void){
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void){ return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void){ gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }`;

/** Helper for plugin authors: a WebGL fragment-shader filter with float uniforms. */
export function glFilter(fragment: string, uniforms: Record<string, number> = {}, name = 'px-filter'): Filter {
  const u: Record<string, { value: number; type: 'f32' }> = {};
  for (const k in uniforms) u[k] = { value: uniforms[k]!, type: 'f32' };
  return new Filter({
    glProgram: GlProgram.from({ vertex: FILTER_VERT, fragment, name }),
    resources: { pxUniforms: new UniformGroup(u) },
  });
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

registerFilter('none', () => null);

/** Snaps sampling to blocks of `size` source pixels. */
registerFilter('pixelate', (p) => glFilter(`
in vec2 vTextureCoord; out vec4 finalColor;
uniform sampler2D uTexture; uniform vec4 uInputSize; uniform float uSize;
void main(void){
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 c = (floor(px / uSize) + 0.5) * uSize;
  finalColor = texture(uTexture, c * uInputSize.zw);
}`, { uSize: Math.max(1, num(p.size, 2)) }, 'pixelate'));

/** Multiplies the color: example of a cheap grade (params: r,g,b). */
registerFilter('tint', (p) => glFilter(`
in vec2 vTextureCoord; out vec4 finalColor;
uniform sampler2D uTexture; uniform float uR; uniform float uG; uniform float uB;
void main(void){ vec4 c = texture(uTexture, vTextureCoord); finalColor = vec4(c.rgb * vec3(uR, uG, uB), c.a); }`,
{ uR: num(p.r, 1), uG: num(p.g, 0.97), uB: num(p.b, 0.9) }, 'tint'));

/** Darkens the corners (params: strength). */
registerFilter('vignette', (p) => glFilter(`
in vec2 vTextureCoord; out vec4 finalColor;
uniform sampler2D uTexture; uniform float uStrength;
void main(void){
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 d = vTextureCoord - 0.5;
  float v = 1.0 - dot(d, d) * uStrength;
  finalColor = vec4(c.rgb * v, c.a);
}`, { uStrength: num(p.strength, 0.9) }, 'vignette'));
