/**
 * Browser half of the hello plugin: one filter, `hello-sepia`. Pixi comes from the host
 * (`globalThis.__pixelagents.pixi`), so the bundle imports nothing at runtime.
 */
import type { Filter } from 'pixi.js';

interface PixiLike {
  Filter: new (o: Record<string, unknown>) => Filter;
  GlProgram: { from(o: Record<string, unknown>): unknown };
  UniformGroup: new (u: Record<string, unknown>) => unknown;
}

const VERT = `in vec2 aPosition;
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

const FRAG = `precision highp float;
in vec2 vTextureCoord; out vec4 finalColor;
uniform sampler2D uTexture; uniform float uAmount;
void main(void){
  vec4 c = texture(uTexture, vTextureCoord);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 sepia = l * vec3(1.2, 1.0, 0.8);
  finalColor = vec4(mix(c.rgb, sepia, uAmount), c.a);
}`;

/** params: `amount` 0..1 (default 0.6). */
export function sepia(params: Record<string, unknown>): Filter {
  const pixi = (globalThis as { __pixelagents?: { pixi?: PixiLike } }).__pixelagents?.pixi;
  if (!pixi) throw new Error('hello: the host did not expose pixi');
  const a = typeof params.amount === 'number' ? Math.min(1, Math.max(0, params.amount)) : 0.6;
  return new pixi.Filter({
    glProgram: pixi.GlProgram.from({ vertex: VERT, fragment: FRAG, name: 'hello-sepia' }),
    resources: { pxUniforms: new pixi.UniformGroup({ uAmount: { value: a, type: 'f32' } }) },
  });
}

export default { name: 'hello', filters: { 'hello-sepia': sepia } };
