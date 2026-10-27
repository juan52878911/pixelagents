import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRules, matches, mergeConfig, DEFAULT_CONFIG } from '@pixelagents/protocol';
import plugin, { kindlingEventsAdapter, kindlingPsAdapter } from '../src/index.js';

const fx = (n: string) => readFileSync(new URL('../../../fixtures/' + n, import.meta.url), 'utf8');
const ps = JSON.parse(fx('kling.ps.json')) as Record<string, unknown>[];
const ctx = (input: string, options: Record<string, unknown> = {}) => ({ input, options, now: () => new Date('2026-01-15T10:00:00Z') });

describe('kindling-ps', () => {
  it('fixture: 6 machines → 12 events (state + metric) on 6 vm entities', () => {
    const evs = kindlingPsAdapter.parse(ps, ctx('ps1'));
    expect(evs).toHaveLength(12);
    expect(new Set(evs.map((e) => e.entity)).size).toBe(6);
    const st = Object.fromEntries(evs.filter((e) => e.kind === 'state').map((e) => [e.entity, e.attrs!.status]));
    expect(st).toEqual({
      'vm:0000000000001000': 'running',
      'vm:0000000000001001': 'running',
      'vm:0000000000001002': 'frozen',
      'vm:0000000000001003': 'ended',
      'vm:0000000000001004': 'failed',
      'vm:0000000000001005': 'starting',
    });
  });

  it('labels and metrics', () => {
    const evs = kindlingPsAdapter.parse(ps, ctx('ps2'));
    const e = evs.find((x) => x.entity === 'vm:0000000000001001' && x.kind === 'metric')!;
    expect(e.labels).toEqual({ name: 'delega-20260111-0900-101', image: 'node22', owner: 'work' });
    expect(e.attrs).toEqual({ cpu_pct: 150, mem_mib: 4096 });
  });

  it('machines that vanish from the listing become ended', () => {
    const c = ctx('ps3');
    kindlingPsAdapter.parse(ps, c);
    const evs = kindlingPsAdapter.parse(ps.slice(0, 5), c);
    const gone = evs.filter((e) => e.entity === 'vm:0000000000001005');
    expect(gone).toHaveLength(1);
    expect(gone[0]).toMatchObject({ kind: 'state', attrs: { status: 'ended' } });
    // and not reported again afterwards
    expect(kindlingPsAdapter.parse(ps.slice(0, 5), c).some((e) => e.entity === 'vm:0000000000001005')).toBe(false);
  });

  it('agentFromName links the parent', () => {
    const evs = kindlingPsAdapter.parse(ps, ctx('ps4', { agentFromName: '^delega-(\\d{8})' }));
    expect(evs.find((e) => e.entity === 'vm:0000000000001000')!.parent).toBe('agent:20260110');
    expect(evs.find((e) => e.entity === 'vm:0000000000001004')!.parent).toBeUndefined();
  });

  it('non-arrays yield nothing', () => {
    expect(kindlingPsAdapter.parse('x', ctx('ps5'))).toEqual([]);
  });
});

describe('kindling-events', () => {
  const evs = fx('kling.events.jsonl').trim().split('\n').flatMap((l) => kindlingEventsAdapter.parse(JSON.parse(l), ctx('k')));

  it('fixture: 14 events over 5 vms with mapped states', () => {
    expect(evs).toHaveLength(14);
    expect(new Set(evs.map((e) => e.entity)).size).toBe(5);
    const last = new Map<string, unknown>();
    for (const e of evs) last.set(e.entity, e.attrs!.status);
    expect(Object.fromEntries(last)).toEqual({
      'vm:0000000000001000': 'running',
      'vm:0000000000001001': 'running',
      'vm:0000000000001002': 'running', // frozen then thawed
      'vm:0000000000001003': 'ended',
      'vm:0000000000001004': 'failed',
    });
    expect(evs.find((e) => e.attrs!.status === 'frozen')).toBeDefined();
  });

  it('failed carries the reason; ts comes from the source', () => {
    const f = evs.find((e) => e.attrs!.status === 'failed')!;
    expect(f.attrs!.reason).toBe('guest agent did not answer');
    expect(f.ts).toBe('2026-01-15T09:00:24.000Z');
  });

  it('unknown event types are ignored', () => {
    expect(kindlingEventsAdapter.parse({ time: 't', type: 'machine.exploded', id: '1' }, ctx('k'))).toEqual([]);
  });
});

describe('defaults', () => {
  it('put vm entities in the kindling lab with the vm behaviors', () => {
    const cfg = mergeConfig(DEFAULT_CONFIG, plugin.defaults);
    expect(cfg.groups.kinds).toMatchObject({ kindling: 'lab' });
    expect(cfg.behaviors.vm).toEqual({ running: 'type', frozen: 'frozen', failed: 'fire', ended: 'dead', starting: 'teleport' });
    const vm = { kind: 'vm', labels: {}, view: {} } as never;
    expect(matches(vm, cfg.classify.at(-1)!.match)).toBe(true);
    const out = applyRules(vm, cfg.classify) as { view: Record<string, string> };
    expect(out.view).toMatchObject({ group: 'kindling', behavior: 'vm' });
  });
});
