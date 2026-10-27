import { describe, expect, it } from 'vitest';
import { feedLine, fmtAgo, fmtCost, fmtDuration, shortPath } from '../src/ui/format.js';
import { filterIds, matches } from '../src/ui/inspector/filter.js';
import { WaitingTracker } from '../src/ui/inspector/alerts.js';
import type { Entity } from '@pixelagents/protocol';

const ent = (id: string, status: string, labels: Record<string, string> = {}, tool?: string): Entity => ({
  id, kind: 'agent', labels, status, metrics: {}, firstSeen: 'x', lastSeen: 'x', history: [], view: {},
  activity: tool ? { tool, since: 'x' } : undefined,
});

describe('format', () => {
  it('durations', () => {
    expect(fmtDuration(4_000)).toBe('4s');
    expect(fmtDuration(192_000)).toBe('3m 12s');
    expect(fmtDuration(7_500_000)).toBe('2h 05m');
    expect(fmtDuration(97_200_000)).toBe('1d 3h');
    expect(fmtDuration(-5)).toBe('0s');
  });
  it('relative time', () => {
    const now = Date.parse('2026-01-01T00:10:00Z');
    expect(fmtAgo('2026-01-01T00:09:59Z', now)).toBe('ahora');
    expect(fmtAgo('2026-01-01T00:09:30Z', now)).toBe('hace 30s');
    expect(fmtAgo('2026-01-01T00:07:00Z', now)).toBe('hace 3 min');
    expect(fmtAgo('nope', now)).toBe('—');
  });
  it('cost', () => {
    expect(fmtCost(0)).toBe('$0.00');
    expect(fmtCost(0.0042)).toBe('$0.0042');
    expect(fmtCost(1.236)).toBe('$1.24');
    expect(fmtCost(1234.5)).toBe('$1,235');
  });
  it('short paths relative to the repo', () => {
    expect(shortPath('/home/dev/web-app/src/app.ts', 'web-app')).toBe('src/app.ts');
    expect(shortPath('/Users/ana/notes/a.md')).toBe('~/notes/a.md');
    expect(shortPath('/a/very/long/path/that/keeps/going/and/going/forever/file.ts', undefined, 20)).toHaveLength(20);
  });
  it('feed line', () => {
    const e = ent('agent:1', 'working', { host: 'laptop', repo: 'web-app' });
    const ev = { ts: 't', source: 's', entity: 'agent:1', kind: 'tool.pre', attrs: { tool: 'Edit', detail: '/h/web-app/src/app.ts' } };
    expect(feedLine(ev, e)).toBe('laptop/web-app · Edit src/app.ts');
  });
});

describe('filter', () => {
  const a = ent('agent:a', 'working', { repo: 'web-app', team: 'core', account: 'work' }, 'Edit');
  const b = ent('agent:b', 'waiting', { repo: 'api', team: 'growth', account: 'personal' }, 'Bash');
  it('matches text across repo, team, account and tool, all words required', () => {
    expect(matches(a, { text: 'web-app', status: null })).toBe(true);
    expect(matches(a, { text: 'CORE edit', status: null })).toBe(true);
    expect(matches(a, { text: 'api', status: null })).toBe(false);
    expect(matches(b, { text: 'personal bash', status: null })).toBe(true);
  });
  it('filters by status and returns null for an empty filter', () => {
    expect(filterIds([a, b], { text: '', status: null })).toBeNull();
    expect(filterIds([a, b], { text: '', status: 'waiting' })).toEqual(['agent:b']);
    expect(filterIds([a, b], { text: 'web', status: 'waiting' })).toEqual([]);
  });
});

describe('WaitingTracker', () => {
  it('fires only on the transition into waiting', () => {
    const t = new WaitingTracker();
    t.reset([ent('a', 'waiting'), ent('b', 'working')]);
    expect(t.update([ent('a', 'waiting')], [])).toEqual([]);
    expect(t.update([ent('b', 'waiting')], []).map((e) => e.id)).toEqual(['b']);
    expect(t.update([ent('b', 'waiting')], [])).toEqual([]);
    expect([...t.waiting.keys()]).toEqual(['a', 'b']);
    t.update([ent('b', 'working')], []);
    expect(t.update([ent('b', 'waiting')], []).map((e) => e.id)).toEqual(['b']);
    t.update([], ['a']);
    expect([...t.waiting.keys()]).toEqual(['b']);
  });
  it('a brand-new entity born waiting also alerts', () => {
    const t = new WaitingTracker();
    expect(t.update([ent('n', 'waiting')], []).map((e) => e.id)).toEqual(['n']);
  });
});
