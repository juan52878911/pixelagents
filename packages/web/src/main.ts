/**
 * Engine demo page: 50 walking actors driven by a synthetic store, 3 filters, perf HUD.
 * Query: ?n=50 actors, ?fx=0 disables filters, ?live connects to /events instead of the demo feed,
 * ?gpu=1 prefers WebGPU. `window.__pa` exposes the engine and stats (used by scripts/perf.mjs).
 */
import type { PxFile } from '@pixelagents/protocol';
import { type BehaviorContext, setBehavior } from './engine/behaviors.js';
import { Engine } from './engine/engine.js';
import { SpriteLibrary } from './engine/library.js';
import { PainterLayer } from './engine/painter-gpu.js';
import { PerfHud } from './perf-hud.js';
import { Store, startDemo } from './store.js';
import charPx from './engine/test-sprites/char.px.json';

const q = new URLSearchParams(location.search);
const N = Math.max(1, Number(q.get('n') ?? 50));

const SKINS = [
  { H: '#2b1d16', S: '#f2c7a5', s: '#d9a37f', B: '#3b7dd8', b: '#2756a3' },
  { H: '#5a3a22', S: '#d9a07a', s: '#b97f58', B: '#ec8a3c', b: '#b8601f' },
  { H: '#c9a227', S: '#a86b45', s: '#86512f', B: '#9b5de5', b: '#6a3bb0' },
  { H: '#3a2e5c', S: '#6e432a', s: '#55321d', B: '#4cc38a', b: '#2e8a5e' },
];

async function main(): Promise<void> {
  const engine = new Engine();
  await engine.init({
    parent: document.getElementById('app')!,
    world: { width: 480, height: 328, fps: 60 },
    preference: q.get('gpu') ? 'webgpu' : 'webgl',
    background: 0x1c1726,
  });
  engine.lib.addFile(charPx as unknown as PxFile);
  const lib: SpriteLibrary = engine.lib;

  // Procedural floor drawn through the Painter API.
  const floor = new PainterLayer(480, 328);
  const p = floor.painter;
  for (let y = 0; y < 328; y += 8) for (let x = 0; x < 480; x += 8) p.rect(x, y, 8, 8, ((x + y) / 8) % 2 ? '#2a2236' : '#241d2f');
  p.text('PIXELAGENTS ENGINE DEMO', 8, 6, '#ffe9a8', 2);
  floor.flush();
  engine.layers.world.addChild(floor.sprite);
  engine.cacheLayer('world');

  engine.applyEffects(q.get('fx') === '0' ? [] : [
    { layer: 'world', filter: 'tint', params: { r: 1, g: 0.97, b: 0.92 } },
    { layer: 'actors', filter: 'pixelate', params: { size: 1 } },
    { layer: 'screen', filter: 'vignette', params: { strength: 0.8 } },
  ]);

  const ctx: BehaviorContext = { world: engine.ecs, width: 480, height: 328, dt: 0 };
  const store = new Store();
  store.subscribe((change) => {
    if (change.type === 'snapshot') {
      for (const e of [...engine.ecs.entities]) engine.despawn(e);
      for (const ent of store.entities.values()) addActor(ent.id, Number(ent.id.split('-')[1]));
    } else if (change.type === 'delta') {
      for (const ent of change.upsert) {
        const a = engine.ecs.get(ent.id);
        if (a) setBehavior(a, ent.status === 'working' || ent.status === 'thinking' ? 'wander' : 'idle', ctx);
      }
      for (const id of change.remove) { const a = engine.ecs.get(id); if (a) engine.despawn(a); }
    }
  });

  function addActor(id: string, i: number): void {
    const skin = SKINS[i % SKINS.length]!;
    const sheet = lib.get('char.front', { palette: skin, overlay: i % 2 ? 'acc.tie' : 'acc.cap' });
    const a = engine.spawn(id, sheet, 16 + ((i * 53) % 448), 40 + ((i * 37) % 270));
    a.animator!.tag = 'walk';
    a.animator!.time = i * 97;
    setBehavior(a, 'wander', ctx);
  }

  if (q.has('live')) store.connect('/events');
  else startDemo(store, N);

  const hud = new PerfHud(document.body, { actors: () => engine.ecs.size, drawCalls: () => engine.drawCalls, backend: engine.backend });
  engine.onFrame.push((_dt, ms) => hud.frame(ms));
  engine.start();

  (window as unknown as { __pa: unknown }).__pa = { engine, store, hud, lib };
}

void main();
