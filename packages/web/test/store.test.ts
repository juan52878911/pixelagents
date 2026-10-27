import type { Delta, Entity, PaConfig, StateSnapshot } from '@pixelagents/protocol';
import { DEFAULT_CONFIG } from '@pixelagents/protocol';
import { describe, expect, it, vi } from 'vitest';
import { type EventSourceLike, Store, startDemo } from '../src/store.js';
import { loadClientPlugins } from '../src/plugin-api.js';
import { getStrategy } from '../src/world/strategies.js';

const ent = (id: string, status = 'idle'): Entity => ({
  id, kind: 'agent', labels: {}, status, metrics: {}, firstSeen: 'x', lastSeen: 'x', history: [], view: {},
});
const snap = (seq: number, ids: string[]): StateSnapshot => ({ protocol: 1, seq, entities: ids.map((i) => ent(i)), groups: [] });

describe('Store', () => {
  it('applies a snapshot then in-order deltas', () => {
    const s = new Store();
    s.applySnapshot(snap(5, ['a', 'b']));
    s.applyDelta({ seq: 6, upsert: [ent('c')], remove: ['a'] });
    expect([...s.entities.keys()].sort()).toEqual(['b', 'c']);
    expect(s.seq).toBe(6);
  });
  it('orders out-of-order deltas by seq and applies later writes last', () => {
    const s = new Store();
    s.applySnapshot(snap(0, ['a']));
    const seen: number[] = [];
    s.subscribe((c, st) => { if (c.type === 'delta') seen.push(st.seq); });
    s.applyDelta({ seq: 3, upsert: [ent('a', 'third')] });
    s.applyDelta({ seq: 2, upsert: [ent('a', 'second')] });
    expect(s.seq).toBe(0); // nothing applied yet: seq 1 missing
    s.applyDelta({ seq: 1, upsert: [ent('b')] });
    expect(seen).toEqual([1, 2, 3]);
    expect(s.entities.get('a')!.status).toBe('third');
    expect(s.entities.has('b')).toBe(true);
  });
  it('drops stale and duplicate deltas', () => {
    const s = new Store();
    s.applySnapshot(snap(10, ['a']));
    expect(s.applyDelta({ seq: 9, remove: ['a'] })).toBe(false);
    expect(s.applyDelta({ seq: 10, remove: ['a'] })).toBe(false);
    expect(s.entities.has('a')).toBe(true);
  });
  it('holds deltas received before the snapshot and applies them after', () => {
    const s = new Store();
    s.applyDelta({ seq: 4, upsert: [ent('late')] });
    s.applyDelta({ seq: 3, upsert: [ent('mid')] });
    s.applySnapshot(snap(2, ['a']));
    expect([...s.entities.keys()].sort()).toEqual(['a', 'late', 'mid']);
    expect(s.seq).toBe(4);
  });
  it('a new snapshot replaces everything and discards older pending deltas', () => {
    const s = new Store();
    s.applySnapshot(snap(0, ['a']));
    s.applyDelta({ seq: 5, upsert: [ent('x')] });
    s.applySnapshot(snap(7, ['b']));
    expect([...s.entities.keys()]).toEqual(['b']);
    s.applyDelta({ seq: 8, upsert: [ent('c')] });
    expect([...s.entities.keys()].sort()).toEqual(['b', 'c']);
  });
  it('tracks groups and forwards raw events', () => {
    const s = new Store();
    s.applySnapshot(snap(0, []));
    const events: unknown[] = [];
    s.subscribe((c) => { if (c.type === 'delta') events.push(...c.events); });
    const g = { id: 'g', kind: 'office', label: 'G', labels: {}, metrics: {} };
    s.applyDelta({ seq: 1, groups: [g], events: [{ ts: 't', source: 's', entity: 'e', kind: 'k' }] });
    expect(s.groups.get('g')).toEqual(g);
    expect(events).toHaveLength(1);
    s.applyDelta({ seq: 2, removeGroups: ['g'] });
    expect(s.groups.size).toBe(0);
  });
  it('unsubscribe stops notifications', () => {
    const s = new Store();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    s.applySnapshot(snap(0, []));
    off();
    s.applySnapshot(snap(1, []));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

class FakeES implements EventSourceLike {
  handlers = new Map<string, (ev: { data: string }) => void>();
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  addEventListener(t: string, cb: (ev: { data: string }) => void) { this.handlers.set(t, cb); }
  close() { this.closed = true; }
  send(t: string, data: unknown) { this.handlers.get(t)?.({ data: JSON.stringify(data) }); }
}

describe('Store connection', () => {
  it('parses named SSE events, handles config/assets, and reconnects with a fresh snapshot', () => {
    vi.useFakeTimers();
    const sources: FakeES[] = [];
    const s = new Store();
    const changes: string[] = [];
    s.subscribe((c) => changes.push(c.type));
    s.connect('/events', () => { const f = new FakeES(); sources.push(f); return f; });
    const es = sources[0]!;
    es.send('snapshot', snap(1, ['a']));
    es.send('delta', { seq: 2, upsert: [ent('b')] } satisfies Delta);
    es.send('config', DEFAULT_CONFIG satisfies PaConfig);
    es.send('assets', { changed: ['x.px.json'] });
    expect(s.entities.size).toBe(2);
    expect(s.config).toBeTruthy();
    expect(changes).toContain('assets');
    expect(s.status).toBe('open');

    es.onerror!(new Error('drop'));
    expect(es.closed).toBe(true);
    expect(s.status).toBe('reconnecting');
    vi.advanceTimersByTime(600);
    expect(sources).toHaveLength(2);
    sources[1]!.send('snapshot', snap(40, ['z']));
    expect([...s.entities.keys()]).toEqual(['z']);
    expect(s.seq).toBe(40);
    s.close();
    expect(s.status).toBe('closed');
    vi.useRealTimers();
  });
  it('ignores malformed event payloads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const es = new FakeES();
    const s = new Store();
    s.connect('/events', () => es);
    es.handlers.get('delta')!({ data: '{nope' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    s.close();
  });
});

describe('demo feed', () => {
  it('emits a snapshot and ordered deltas', () => {
    vi.useFakeTimers();
    const s = new Store();
    const stop = startDemo(s, 6);
    expect(s.entities.size).toBe(6);
    vi.advanceTimersByTime(1000);
    expect(s.seq).toBe(10);
    stop();
    vi.useRealTimers();
  });
});

describe('plugin loading', () => {
  it('registers behaviors/filters/strategies from a client module and skips failing ones', async () => {
    const reg = { behaviors: [] as string[], filters: [] as string[] };
    const errors: string[] = [];
    const loaded = await loadClientPlugins(['ok', 'bad'], {
      registerBehavior: (n) => reg.behaviors.push(n),
      registerFilter: (n) => reg.filters.push(n),
      importModule: async (u) => {
        if (u.includes('bad')) throw new Error('404');
        return { default: { name: 'ok', behaviors: { dance: { update() {} } }, filters: { crt: () => null }, strategies: { alas: {} } } };
      },
      onError: (n) => errors.push(n),
    });
    expect(loaded.map((p) => p.name)).toEqual(['ok']);
    expect(reg).toEqual({ behaviors: ['dance'], filters: ['crt'] });
    expect(errors).toEqual(['bad']);
  });

  it('a function strategy from a client plugin reaches the world generator', async () => {
    const fn = () => {};
    await loadClientPlugins(['strat'], {
      registerBehavior: () => {},
      registerFilter: () => {},
      importModule: async () => ({ default: { name: 'strat', strategies: { 'plugin-strat': fn, opaque: {} } } }),
    });
    expect(getStrategy('plugin-strat')).toBe(fn);
    expect(getStrategy('opaque')).toBeUndefined();
  });
});
