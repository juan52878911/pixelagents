// Preview harness (browser only, not shipped): mounts the real Engine with a small test scene,
// loads the BUILT plugin (/plugins/effects/client.js) through loadClientPlugins and exposes
// window.__fx so the Playwright check can switch filters on and off.
import * as pixi from 'pixi.js';
import { Graphics, Rectangle } from 'pixi.js';
import { Engine } from '../../../packages/web/src/engine/engine.js';
import { createFilter, registerFilter } from '../../../packages/web/src/engine/filters.js';
import { getBehavior, registerBehavior, setBehavior } from '../../../packages/web/src/engine/behaviors.js';
import { loadPxUrls } from '../../../packages/web/src/engine/library.js';
import { FILTER_SPECS } from '../src/client/specs.js';
import { loadClientPlugins } from '../../../packages/web/src/plugin-api.js';

// What the host must do for plugins (proposed change to packages/web/src/main.ts).
(globalThis as Record<string, unknown>).__pixelagents = { pixi };

const W = 480, H = 328;

function paintWorld(g: Graphics): void {
  g.rect(0, 0, W, H).fill(0x2f3a2c); // grass
  for (let i = 0; i < 90; i++) g.rect((i * 53) % W, (i * 97) % H, 2, 1).fill(0x3f5a38);
  g.rect(0, 150, W, 22).fill(0x5b5470); // road
  for (let x = 0; x < W; x += 24) g.rect(x, 160, 12, 2).fill(0xe9f2f7);
  // houses with lit windows (very bright pixels = lights at night)
  const house = (x: number, y: number, wall: number, roof: number): void => {
    g.rect(x, y, 70, 46).fill(wall);
    g.rect(x - 3, y - 14, 76, 16).fill(roof);
    for (let i = 0; i < 3; i++) {
      g.rect(x + 8 + i * 20, y + 12, 12, 14).fill(0xfff1a8);
      g.rect(x + 8 + i * 20, y + 18, 12, 1).fill(0xb8860b);
    }
    g.rect(x + 30, y + 30, 10, 16).fill(0x6b4329);
  };
  house(30, 60, 0xa8744c, 0xa8322a);
  house(150, 70, 0x8f96a3, 0x3b3346);
  house(300, 56, 0xc9a06a, 0x2e8a5e);
  house(60, 210, 0x8f96a3, 0xa8322a);
  house(250, 220, 0xa8744c, 0x3b3346);
  // campfire
  g.rect(400, 250, 16, 4).fill(0x6b4329);
  g.poly([402, 250, 408, 232, 414, 250]).fill(0xf0802a);
  g.poly([405, 250, 408, 238, 411, 250]).fill(0xffd23f);
  g.rect(407, 244, 2, 6).fill(0xfff6c9);
  // monitor
  g.rect(380, 290, 40, 26).fill(0x1a1423);
  g.rect(383, 293, 34, 20).fill(0x5ad1e6);
  g.rect(386, 297, 14, 2).fill(0xe9f2f7);
  g.rect(386, 302, 22, 2).fill(0x9be8f5);
}

const engine = await new Engine().init({ parent: document.getElementById('root')!, world: { width: W, height: H }, scale: 2, resizeTo: document.getElementById('root')! });
const g = new Graphics();
paintWorld(g);
engine.layers.world.addChild(g);

await loadPxUrls(engine.lib, ['/char.px.json']);
const sheet = engine.lib.get('char.front');
registerBehavior('stroll', {
  enter(a) { a.behavior!.data.t = a.id * 0.7; },
  update(a, dt) { const d = a.behavior!.data; d.t = (d.t as number) + dt; a.transform.x = 20 + ((a.id * 37 + (d.t as number) * 14) % (W - 40)); },
});
for (let i = 0; i < 12; i++) {
  const e = engine.spawn(`a${i}`, sheet, 30 + i * 36, 120 + ((i * 29) % 160));
  setBehavior(e, 'stroll', { world: engine.ecs, width: W, height: H, dt: 0 });
}
void getBehavior;

const host = {
  registerBehavior,
  registerFilter,
  onError: (n: string, e: unknown) => { throw new Error(`plugin ${n}: ${String(e)}`); },
};
await loadClientPlugins(['effects'], host);
engine.start();

type Fx = { layer: string; filter: string; params?: Record<string, unknown> };
(window as unknown as Record<string, unknown>).__fx = {
  engine,
  specs: FILTER_SPECS,
  /** Apply a list of effects. layer 'frame' = the whole logical frame (see report: needed in the engine). */
  apply(list: Fx[]): void {
    const frame = list.filter((f) => f.layer === 'frame');
    const rest = list.filter((f) => f.layer !== 'frame').map((f) => ({ ...f }));
    engine.applyEffects(rest as never);
    const scene = (engine as unknown as { scene: { filters: unknown; filterArea: unknown } }).scene;
    const filt = frame.length ? frame.map((f) => createFilter(f.filter, f.params ?? {})!) : null;
    scene.filters = filt;
    scene.filterArea = filt ? new Rectangle(0, 0, W, H) : null;
  },
};
