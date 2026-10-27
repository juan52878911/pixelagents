import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Adapter, PaEvent } from '@pixelagents/protocol';
import { claudeCodeAdapter } from '../../claude-code/src/index.js';
import { nodAdapter } from '../../nod/src/index.js';
import { hostStatsAdapter } from '../../host-stats/src/index.js';
import { delegaQuotaAdapter, delegaSpendAdapter } from '../../delega/src/index.js';
import { kindlingEventsAdapter, kindlingPsAdapter } from '../../kindling/src/index.js';
import { mapAdapter } from '../src/index.js';

const fx = (n: string) => readFileSync(new URL('../../../fixtures/' + n, import.meta.url), 'utf8');
const jsonl = (n: string) => fx(n).trim().split('\n').map((l) => JSON.parse(l));
const ctx = (options: Record<string, unknown> = {}) => ({ input: 'x', options, now: () => new Date('2026-01-15T10:00:00Z') });

describe('privacy: no adapter output contains SECRET', () => {
  it('SECRET strings exist in the fixtures (the test can fail)', () => {
    expect(fx('nod.events.jsonl')).toContain('SECRET');
    expect(fx('hook-payloads.json')).toContain('SECRET');
  });

  const all = (): Array<[string, PaEvent[]]> => {
    const run = (a: Adapter, raws: unknown[], o: Record<string, unknown> = {}) => raws.flatMap((r) => a.parse(r, ctx(o)));
    return [
      ['claude-code v1', run(claudeCodeAdapter, jsonl('claude-code.v1.jsonl'))],
      ['claude-code legacy', run(claudeCodeAdapter, jsonl('claude-code.legacy.jsonl'))],
      ['claude-code hook payloads', run(claudeCodeAdapter, JSON.parse(fx('hook-payloads.json')))],
      ['nod', run(nodAdapter, jsonl('nod.events.jsonl'))],
      ['host linux', run(hostStatsAdapter, [fx('host.linux.txt')], { host: 'h' })],
      ['host macos', run(hostStatsAdapter, [fx('host.macos.txt')], { host: 'h' })],
      ['delega quota', run(delegaQuotaAdapter, [fx('delega.quota.txt')])],
      ['delega spend', run(delegaSpendAdapter, [fx('delega.spend.txt')])],
      ['kindling ps', run(kindlingPsAdapter, [JSON.parse(fx('kling.ps.json'))])],
      ['kindling events', run(kindlingEventsAdapter, jsonl('kling.events.jsonl'))],
      ['map (explicit attrs only)', run(mapAdapter, jsonl('nod.events.jsonl'), { entity: 'nod:{{nod}}', kind: 'heartbeat', attrs: { v: '{{nod}}' } })],
    ];
  };

  it('produces events and none carries SECRET', () => {
    for (const [name, evs] of all()) {
      if (!name.includes('hook')) expect(evs.length, name).toBeGreaterThan(0);
      expect(JSON.stringify(evs), name).not.toContain('SECRET');
    }
  });
});
