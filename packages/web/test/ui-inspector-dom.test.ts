// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@pixelagents/protocol';
import { Store } from '../src/store.js';
import { mountInspector } from '../src/ui/inspector.js';
import type { SceneApi } from '../src/ui/types.js';

const ent = (id: string, status: string, extra: Partial<Entity> = {}): Entity => ({
  id, kind: 'agent', labels: { repo: 'web-app', host: 'laptop' }, status, metrics: { cost_usd: 0.5 },
  firstSeen: 'x', lastSeen: new Date().toISOString(), history: [], view: {}, ...extra,
});

function setup() {
  const store = new Store();
  const act = { tool: 'Edit', detail: '/h/web-app/src/app.ts', since: new Date().toISOString() };
  store.applySnapshot({ protocol: 1, seq: 0, entities: [ent('agent:a', 'working', { activity: act }), ent('agent:b', 'idle')], groups: [] });
  let sel: (id: string | null) => void = () => {};
  const scene: SceneApi = {
    onSelect: vi.fn((cb) => { sel = cb; }), focus: vi.fn(), highlight: vi.fn(), screenPos: () => null,
  };
  const root = document.createElement('div');
  document.body.append(root);
  const dispose = mountInspector({ store, scene, root });
  return { store, scene, root, dispose, select: (id: string | null) => sel(id) };
}
const q = (root: HTMLElement, id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement | null;

afterEach(() => { document.body.innerHTML = ''; });

describe('mountInspector', () => {
  it('shows tool and detail of the selected agent', () => {
    const { root, select, dispose } = setup();
    select('agent:a');
    expect(q(root, 'inspector-tool')!.textContent).toBe('Edit');
    expect(q(root, 'inspector-detail')!.textContent).toBe('/h/web-app/src/app.ts');
    expect(q(root, 'inspector-status')!.textContent).toBe('trabajando');
    select(null);
    expect(q(root, 'inspector')!.hidden).toBe(true);
    dispose();
  });
  it('raises a waiting chip when an entity becomes waiting, and the chip focuses it', () => {
    const { store, scene, root, dispose } = setup();
    expect(root.querySelectorAll('[data-testid=waiting-chip]').length).toBe(0);
    store.applyDelta({ seq: 1, upsert: [ent('agent:a', 'waiting')] });
    const chips = root.querySelectorAll<HTMLElement>('[data-testid=waiting-chip]');
    expect(chips.length).toBe(1);
    chips[0]!.click();
    expect(scene.focus).toHaveBeenCalledWith('agent:a');
    store.applyDelta({ seq: 2, upsert: [ent('agent:a', 'working')] });
    expect(root.querySelectorAll('[data-testid=waiting-chip]').length).toBe(0);
    dispose();
  });
  it('search highlights matching ids and clears with null', () => {
    const { scene, root, dispose } = setup();
    const s = q(root, 'search') as HTMLInputElement;
    s.value = 'edit'; s.dispatchEvent(new Event('input'));
    expect(scene.highlight).toHaveBeenLastCalledWith(['agent:a']);
    s.value = ''; s.dispatchEvent(new Event('input'));
    expect(scene.highlight).toHaveBeenLastCalledWith(null);
    dispose();
  });
  it('HUD counts per status and feed lines from delta events', () => {
    const { store, root, dispose } = setup();
    expect(q(root, 'hud-counts')!.textContent).toContain('1 trabajando');
    store.applyDelta({ seq: 1, upsert: [], events: [{ ts: new Date().toISOString(), source: 's', entity: 'agent:a', kind: 'tool.pre', attrs: { tool: 'Edit', detail: '/h/web-app/src/x.ts' } }] });
    expect(q(root, 'feed')!.textContent).toContain('laptop/web-app · Edit src/x.ts');
    dispose();
  });
});
