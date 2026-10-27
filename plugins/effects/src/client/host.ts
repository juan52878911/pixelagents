/**
 * Bridge to the host's pixi. A client plugin must not bundle its own copy of pixi.js (two copies
 * would not share GL state), so it takes the classes from `globalThis.__pixelagents.pixi`, which
 * the host sets before loading plugins (see docs/plugins.md, "Filters").
 */
import type { Filter } from 'pixi.js';

/** Same vertex stage as the engine's `glFilter`. */
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

export interface PixiLike {
  Filter: new (opts: Record<string, unknown>) => Filter;
  GlProgram: { from(opts: Record<string, unknown>): unknown };
  UniformGroup: new (u: Record<string, unknown>) => unknown;
}

export function hostPixi(): PixiLike {
  const p = (globalThis as { __pixelagents?: { pixi?: PixiLike } }).__pixelagents?.pixi;
  if (!p || !p.Filter || !p.GlProgram || !p.UniformGroup) {
    throw new Error('effects: the host did not expose pixi (globalThis.__pixelagents.pixi)');
  }
  return p;
}

/** A WebGL fragment filter with float uniforms in the `pxUniforms` group (same layout as the engine's `glFilter`). */
export function makeFilter(fragment: string, uniforms: Record<string, number>, name: string): Filter {
  const { Filter, GlProgram, UniformGroup } = hostPixi();
  const u: Record<string, { value: number; type: 'f32' }> = {};
  for (const k in uniforms) u[k] = { value: uniforms[k]!, type: 'f32' };
  return new Filter({
    glProgram: GlProgram.from({ vertex: FILTER_VERT, fragment: fragment.includes('precision') ? fragment : 'precision highp float;\n' + fragment, name }),
    resources: { pxUniforms: new UniformGroup(u) },
  });
}

/** Writes new float values into a filter built by `makeFilter`. */
export function setUniforms(filter: Filter, values: Record<string, number>): void {
  const g = (filter.resources as Record<string, { uniforms: Record<string, number> }>).pxUniforms;
  if (g) for (const k in values) g.uniforms[k] = values[k]!;
}
