// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@pixelagents/protocol';
import { Store } from '../src/store.js';
import { fmtIntensity, fmtTokens } from '../src/ui/format.js';
import { mountInspector } from '../src/ui/inspector.js';
import type { SceneApi } from '../src/ui/types.js';

const NOW = Date.parse('2026-01-15T10:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const ent = (id: string, status: string, extra: Partial<Entity> = {}): Entity => ({
  id, kind: id.split(':')[0]!, labels: { repo: 'web-app', host: 'laptop' }, status, metrics: {},
  firstSeen: iso(NOW - 60000), lastSeen: iso(NOW), history: [], view: {}, ...extra,
});

function setup(entities: Entity[]) {
  const store = new Store();
  store.applySnapshot({ protocol: 1, seq: 0, entities, groups: [] });
  let sel: (id: string | null) => void = () => {};
  const scene: SceneApi = { onSelect: vi.fn((cb) => { sel = cb; }), focus: vi.fn(), highlight: vi.fn(), screenPos: () => null };
  const root = document.createElement('div');
  document.body.append(root);
  const dispose = mountInspector({ store, scene, root }, { now: () => NOW });
  return { store, scene, root, dispose, select: (id: string | null) => sel(id) };
}
const q = (root: HTMLElement, id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement | null;
afterEach(() => { document.body.innerHTML = ''; });

describe('inspector: turn, effort, totals and relations', () => {
  it('shows the turn in progress with a live duration', () => {
    const a = ent('agent:a', 'working', {
      activity: { tool: 'Bash', detail: 'npm test', category: 'run', since: iso(NOW - 5000) },
      turn: { since: iso(NOW - 83000), n: 3, tools: 7, errors: 1, forks: 2 },
      metrics: { turns: 3, tools: 20, errors: 2, error_streak: 2, intensity: 64, tools_per_min: 7.7, tokens_in: 300, tokens_cache_read: 120000, tokens_out: 4200, cost_est_usd: 0.42, compactions: 1, waits: 2, wait_ms_total: 9000 },
    });
    a.labels.effort = 'high'; a.labels.model = 'claude-sonnet'; a.labels.permission_mode = 'acceptEdits';
    const { root, select, dispose } = setup([a]);
    select('agent:a');
    const panel = q(root, 'inspector')!;
    expect(panel.textContent).toContain('Turno 3 en curso');
    expect(q(root, 'inspector-turn-elapsed')!.textContent).toBe('1m 23s');
    expect(q(root, 'inspector-turn-tools')!.textContent).toBe('7 herr. · 1 err. · 2 subag.');
    expect(q(root, 'inspector-intensity')!.textContent).toBe('■■■□□ 64');
    expect(panel.textContent).toContain('7.7 herr./min');
    expect(panel.textContent).toContain('alto');
    expect(q(root, 'inspector-cost')!.textContent).toBe('≈ $0.42');
    expect(q(root, 'inspector-tokens')!.textContent).toBe('120k → 4.2k');
    expect(q(root, 'inspector-totals')!.textContent).toBe('3 turnos · 20 herr. · 2 err. (2 seguidos) · 1 compact.');
    expect(panel.textContent).toContain('2 · 9s');
    expect(panel.textContent).toContain('acceptEdits');
    dispose();
  });

  it('shows the last turn with tokens and cost, and real cost over the estimate', () => {
    const a = ent('agent:a', 'idle', {
      turn: { since: iso(NOW - 30000), until: iso(NOW - 4000), n: 2, tools: 3, errors: 0, forks: 0 },
      metrics: { turn_ms: 26000, turn_tools: 3, turn_steps: 4, turn_tokens_in: 15000, turn_tokens_out: 900, cost_turn_usd: 0.05, cost_usd: 1.5, cost_est_usd: 1.2, context_tokens: 15000 },
    });
    const { root, select, dispose } = setup([a]);
    select('agent:a');
    const panel = q(root, 'inspector')!;
    expect(panel.textContent).toContain('Último turno (2)');
    expect(q(root, 'inspector-turn-elapsed')!.textContent).toBe('26s');
    expect(q(root, 'inspector-turn-tools')!.textContent).toBe('3 herr. · 4 pasos');
    expect(panel.textContent).toContain('15k → 900');
    expect(panel.textContent).toContain('≈ $0.05');
    expect(q(root, 'inspector-cost')!.textContent).toBe('$1.50');
    expect(panel.textContent).toContain('15k tok');
    dispose();
  });

  it('lists live subagents with their type, and mates of the same repo', () => {
    const p = ent('agent:p', 'working', { metrics: { forks: 3, subagents_live: 1 } });
    const s1 = ent('subagent:p-1', 'working', { parent: 'agent:p', labels: { agent_type: 'Explore' } });
    const s2 = ent('subagent:p-2', 'ended', { parent: 'agent:p', labels: {} });
    const mate = ent('agent:m', 'idle', { labels: { repo: 'web-app', branch: 'feat/x' } });
    const other = ent('agent:o', 'idle', { labels: { repo: 'api' } });
    const { root, select, scene, dispose } = setup([p, s1, s2, mate, other]);
    select('agent:p');
    const panel = q(root, 'inspector')!;
    expect(panel.textContent).toContain('Subagentes · 1 vivos · 3 lanzados');
    const subs = [...root.querySelectorAll<HTMLElement>('[data-testid=inspector-sub]')].map((b) => b.textContent);
    expect(subs).toEqual(['· Explore p-1 · trabajando', '✓ p-2 · terminado']);
    const mates = [...root.querySelectorAll<HTMLElement>('[data-testid=inspector-mate]')];
    expect(mates.map((b) => b.textContent)).toEqual(['m · inactivo · feat/x']);
    expect(panel.textContent).toContain('Mismo repo · 1');
    mates[0]!.click();
    expect(scene.focus).toHaveBeenCalledWith('agent:m');
    dispose();
  });

  it('shows how long a waiting agent has been waiting, and no empty sections', () => {
    const w = ent('agent:w', 'waiting', { activity: { tool: 'Bash', category: 'wait', since: iso(NOW - 42000) } });
    const { root, select, dispose } = setup([w]);
    select('agent:w');
    expect(q(root, 'inspector-waiting')!.textContent).toBe('42s');
    const text = q(root, 'inspector')!.textContent!;
    expect(text).not.toContain('Turno');
    expect(text).not.toContain('Esfuerzo');
    expect(text).not.toContain('Subagentes');
    dispose();
  });
});

describe('format: tokens and intensity', () => {
  it('tokens', () => {
    expect(fmtTokens(undefined)).toBe('—');
    expect(fmtTokens(950)).toBe('950');
    expect(fmtTokens(4200)).toBe('4.2k');
    expect(fmtTokens(120000)).toBe('120k');
    expect(fmtTokens(2_500_000)).toBe('2.5M');
  });
  it('intensity meter', () => {
    expect(fmtIntensity(undefined)).toBe('□□□□□ 0');
    expect(fmtIntensity(100)).toBe('■■■■■ 100');
    expect(fmtIntensity(50)).toBe('■■■□□ 50');
    expect(fmtIntensity(250)).toBe('■■■■■ 100');
  });
});
