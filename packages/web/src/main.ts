/**
 * The app: connects to `/events`, draws the town from what the agents are doing now, and mounts the
 * inspector and settings UI over the canvas. `?demo` feeds synthetic agents instead of the server.
 * `window.__pixelagents` is the hook used by scripts/scene-check.mjs (e2e).
 */
import * as pixi from 'pixi.js';
import { Engine } from './engine/engine.js';
import { loadClientPlugins } from './plugin-api.js';
import { Scene } from './scene/scene.js';
import { Store, startDemo } from './store.js';
import { mountInspector } from './ui/inspector.js';
import { mountSettings } from './ui/settings.js';
import type { UiContext } from './ui/types.js';

const q = new URLSearchParams(location.search);

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  app.style.position = 'relative';
  app.style.width = '100vw';
  app.style.height = '100vh';
  app.style.overflow = 'hidden';
  const store = new Store();
  const engine = new Engine();
  await engine.init({
    parent: app,
    world: { width: 480, height: 328, fps: 60 },
    preference: q.get('gpu') ? 'webgpu' : 'webgl',
    background: 0x14111b,
  });
  // Client plugins take pixi from the host (one copy, shared GL state), so expose it before loading them.
  const g = globalThis as unknown as { __pixelagents?: Record<string, unknown> };
  g.__pixelagents = { ...g.__pixelagents, pixi };
  if (!q.has('demo')) await loadClientPlugins(await clientPluginNames());
  const scene = new Scene({ engine, store, root: app });
  await scene.art.loadServer();
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  app.appendChild(overlay);
  const ctx: UiContext = { store, scene, root: overlay };
  mountSettings(ctx);
  mountInspector(ctx, { onOpenSettings: () => window.dispatchEvent(new CustomEvent('pixelagents:settings')) });

  if (q.has('demo')) startDemo(store, Number(q.get('n') ?? 12));
  else store.connect('/events');
  engine.start();

  g.__pixelagents = {
    ...g.__pixelagents,
    store,
    engine,
    scene: {
      actors: () => scene.actorList(),
      groups: () => scene.groupList(),
      focus: (id: string) => scene.focus(id),
      highlight: (ids: string[] | null) => scene.highlight(ids),
      buildDone: () => scene.buildDone,
      api: scene,
    },
  };
}

/** Names of the server plugins that ship a browser bundle (`/api/plugins` → `client`). */
async function clientPluginNames(): Promise<string[]> {
  try {
    const r = await fetch('/api/plugins');
    if (!r.ok) return [];
    const list = (await r.json()) as { name: string; client?: string }[];
    return list.filter((p) => p.client).map((p) => p.name);
  } catch {
    return [];
  }
}

void main();
