import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig, type Entity, type Group, type PaConfig } from '@pixelagents/protocol';
import { behaviorFor, buildGroups, buildWorldInput, placementFor, seedFor, seasonFor } from '../src/scene/input.js';
import { allowedGags, emojiAt, gagAt } from '../src/scene/fun.js';
import { generateWorld } from '../src/world/index.js';

const T = '2026-01-15T09:00:00.000Z';
function ent(id: string, o: Partial<Entity> = {}): Entity {
  return { id, kind: id.split(':')[0]!, labels: {}, status: 'idle', metrics: {}, firstSeen: T, lastSeen: T, history: [], view: {}, ...o };
}
const cfg = (over: unknown = {}): PaConfig => mergeConfig(DEFAULT_CONFIG, over);
const G = (id: string, kind = 'office'): Group => ({ id, kind, label: id, labels: {}, metrics: {} });

describe('scene: status → behavior', () => {
  it('maps core statuses through the default set', () => {
    const c = cfg();
    const map = Object.fromEntries(['starting', 'working', 'thinking', 'waiting', 'idle', 'sleeping', 'ended', 'weird'].map((s) => [s, behaviorFor(ent('agent:a', { status: s }), c)]));
    expect(map).toEqual({ starting: 'arrive', working: 'type', thinking: 'think', waiting: 'wait', idle: 'idle', sleeping: 'sleep', ended: 'leave', weird: 'idle' });
  });
  it('uses view.behavior sets, config over built-ins, "*" fallback', () => {
    const c = cfg({ behaviors: { vm: { failed: 'dead' } } });
    expect(behaviorFor(ent('subagent:x', { view: { behavior: 'minion' }, status: 'working' }), c)).toBe('minion');
    expect(behaviorFor(ent('subagent:x', { view: { behavior: 'minion' }, status: 'ended' }), c)).toBe('poof');
    expect(behaviorFor(ent('vm:1', { view: { behavior: 'vm' }, status: 'failed' }), c)).toBe('dead'); // config wins
    expect(behaviorFor(ent('vm:1', { view: { behavior: 'vm' }, status: 'frozen' }), c)).toBe('frozen'); // built-in vm set
    expect(behaviorFor(ent('vm:1', { view: { behavior: 'vm' }, status: 'running' }), null)).toBe('running');
    expect(behaviorFor(ent('agent:a', { view: { behavior: 'nope' }, status: 'working' }), c)).toBe('type');
  });
  it('places subagents as minis and lab members in pods', () => {
    expect(placementFor(ent('subagent:s', { parent: 'agent:a', view: { behavior: 'minion' } }), 'office', cfg())).toBe('mini');
    expect(placementFor(ent('vm:1', { view: { behavior: 'vm' }, status: 'running' }), 'lab', cfg())).toBe('pod');
    expect(placementFor(ent('agent:a', { status: 'working' }), 'office', cfg())).toBe('desk');
  });
});

describe('scene: groups → GroupInput', () => {
  const ents = [
    ent('agent:a', { labels: { host: 'laptop', repo: 'api' }, view: { group: 'laptop' } }),
    ent('agent:b', { labels: { host: 'laptop', repo: 'web' }, view: { group: 'laptop' }, firstSeen: '2026-01-15T09:01:00.000Z' }),
    ent('agent:c', { labels: { host: 'laptop', repo: 'api' }, view: { group: 'laptop' }, firstSeen: '2026-01-15T09:02:00.000Z' }),
    ent('subagent:s', { parent: 'agent:a', labels: { host: 'laptop' }, view: { group: 'laptop', behavior: 'minion' } }),
    ent('agent:h', { labels: { host: 'ws', repo: 'x' }, view: { group: 'ws', hidden: true } }),
    ent('vm:1', { view: { group: 'kindling', behavior: 'vm' }, status: 'running' }),
    ent('agent:d', { labels: { host: 'ws', repo: 'x' } }), // no view.group: groups.by template
  ];
  it('zones by labels.repo in arrival order, minis and hidden left out, pods for labs', () => {
    const gs = buildGroups(ents, [G('laptop'), G('kindling', 'lab')], { config: cfg() });
    expect(gs).toEqual([
      { id: 'laptop', kind: 'office', label: 'laptop', zones: [{ id: 'api', label: 'api', agents: ['agent:a', 'agent:c'] }, { id: 'web', label: 'web', agents: ['agent:b'] }] },
      { id: 'kindling', kind: 'lab', label: 'kindling', zones: [], pods: ['vm:1'] },
      { id: 'ws', kind: 'office', label: 'ws', zones: [{ id: 'x', label: 'x', agents: ['agent:d'] }] },
    ]);
  });
  it('honors groups.zones, exclude and empty groups', () => {
    const gs = buildGroups(ents, [G('laptop'), G('empty')], { config: cfg({ groups: { zones: '{{labels.host}}' } }), exclude: new Set(['agent:c']) });
    expect(gs[0]!.zones).toEqual([{ id: 'laptop', label: 'laptop', agents: ['agent:a', 'agent:b'] }]);
    expect(gs.find((g) => g.id === 'empty')).toEqual({ id: 'empty', kind: 'office', label: 'empty', zones: [] });
  });
  it('seed and season from config.world', () => {
    const now = new Date(2026, 9, 26, 12);
    expect(seedFor(cfg(), now)).toBe('2026-10-26');
    expect(seedFor(cfg({ world: { seed: 'fixed:hola' } }), now)).toBe('hola');
    expect(seedFor(cfg({ world: { seed: 'random' } }), now, 'r1')).toBe('r1');
    expect(seasonFor(cfg(), now)).toBe('otono');
    expect(seasonFor(cfg({ world: { season: 'invierno' } }), now)).toBe('invierno');
  });
  it('feeds the generator: every desk agent gets a slot', () => {
    const input = buildWorldInput(ents, [G('laptop'), G('kindling', 'lab')], { config: cfg(), now: new Date(2026, 0, 15) });
    const w = generateWorld(input);
    const seated = w.offices.flatMap((o) => [...o.zones.flatMap((z) => z.slots), ...o.capsules]).flatMap((s) => (s.agent ? [s.agent] : [])).sort();
    expect(seated).toEqual(['agent:a', 'agent:b', 'agent:c', 'agent:d', 'vm:1']);
  });
});

describe('scene: gag scheduler', () => {
  const gags = ['bloque', 'espada', 'seta'];
  const fun = { decor: true, gags: true as boolean | string[], emojis: true, everySec: 8 };
  it('filters gags by config', () => {
    expect(allowedGags({ gags: true }, gags)).toEqual(gags);
    expect(allowedGags({ gags: false }, gags)).toEqual([]);
    expect(allowedGags({ gags: ['seta', 'nope'] }, gags)).toEqual(['seta']);
  });
  it('plays one gag at the start of every period, on a candidate, with p in 0..1', () => {
    const cand = ['agent:a', 'agent:b'];
    let plays = 0;
    for (let t = 0; t < 80; t += 0.1) {
      const g = gagAt(t, fun, gags, () => 2, cand);
      if (!g) continue;
      expect(cand).toContain(g.agent);
      expect(gags).toContain(g.id);
      expect(g.p).toBeGreaterThanOrEqual(0); expect(g.p).toBeLessThanOrEqual(1);
      expect(t % 8).toBeLessThanOrEqual(2.0001);
      plays++;
    }
    expect(plays).toBeGreaterThan(150); // ~2 s of every 8 s
    expect(gagAt(1, fun, gags, () => 2, [])).toBeNull();
    expect(gagAt(1, { ...fun, gags: false }, gags, () => 2, cand)).toBeNull();
    expect(gagAt(1, { ...fun, gags: ['seta'] }, gags, () => 2, cand)?.id).toBe('seta');
    expect(gagAt(1.5, fun, gags, () => 2, cand)).toEqual(gagAt(1.5, fun, gags, () => 2, cand)); // deterministic
  });
  it('throws emojis half a period later unless disabled', () => {
    const cand = ['agent:a'];
    const hits = Array.from({ length: 200 }, (_, i) => emojiAt(i * 0.1, fun, ['emoji.corazon'], cand)).filter(Boolean);
    expect(hits.length).toBeGreaterThan(0);
    expect(emojiAt(2.4, { ...fun, emojis: false }, ['emoji.corazon'], cand)).toBeNull();
  });
});
