import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PaEvent } from '@pixelagents/protocol';
import plugin, { claudeCodeAdapter } from '../src/index.js';

const lines = (n: string) =>
  readFileSync(new URL('../../../fixtures/' + n, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ctx = { input: 'local', options: {}, now: () => new Date('2026-01-15T10:00:00Z') };
const run = (n: string): PaEvent[] => lines(n).flatMap((l) => claudeCodeAdapter.parse(l, ctx));

describe('claude-code adapter', () => {
  it('registers the adapter', () => {
    expect(plugin.adapters?.map((a) => a.name)).toEqual(['claude-code']);
  });

  it('v1 fixture: 191 events over 6 entities', () => {
    const evs = run('claude-code.v1.jsonl');
    expect(evs).toHaveLength(191);
    expect(new Set(evs.map((e) => e.entity))).toEqual(
      new Set(['agent:s-laptop-2', 'agent:s-vm-1', 'agent:s-laptop-1', 'subagent:s-laptop-2-sub0', 'agent:s-ws-1', 'subagent:s-vm-1-sub0']),
    );
    expect(evs.every((e) => e.source === 'local')).toBe(true);
  });

  it('legacy fixture: 187 events over 4 entities, same shape as v1', () => {
    const evs = run('claude-code.legacy.jsonl');
    expect(evs).toHaveLength(187);
    expect(new Set(evs.map((e) => e.entity)).size).toBe(4);
    const v1 = run('claude-code.v1.jsonl').filter((e) => e.entity === 'agent:s-laptop-2');
    const legacy = evs.filter((e) => e.entity === 'agent:s-laptop-2');
    expect(legacy.map((e) => [e.ts, e.kind, e.attrs])).toEqual(v1.map((e) => [e.ts, e.kind, e.attrs]));
  });

  it('labels carry account, host, repo, branch, agent', () => {
    const start = run('claude-code.v1.jsonl').find((e) => e.entity === 'agent:s-laptop-2' && e.kind === 'session.start')!;
    expect(start.labels).toEqual({ account: 'work', host: 'laptop', repo: 'api', branch: 'main', model: 'claude-sonnet', agent: 'dev' });
    expect(start.attrs).toEqual({ model: 'claude-sonnet' });
  });

  it('subagents get their own entity with parent', () => {
    const fork = run('claude-code.v1.jsonl').filter((e) => e.entity === 'subagent:s-laptop-2-sub0');
    expect(fork.map((e) => e.kind)).toEqual(['fork.start', 'fork.end']);
    expect(fork.every((e) => e.parent === 'agent:s-laptop-2')).toBe(true);
  });

  it('tool events carry tool and detail', () => {
    const pre = run('claude-code.v1.jsonl').find((e) => e.kind === 'tool.pre')!;
    expect(pre.attrs).toMatchObject({ tool: 'Grep', detail: 'export function' });
  });

  it('ignores junk and other kinds', () => {
    expect(claudeCodeAdapter.parse('x', ctx)).toEqual([]);
    expect(claudeCodeAdapter.parse({ session: 's', kind: 'other', ts: 't' }, ctx)).toEqual([]);
    expect(claudeCodeAdapter.parse({ kind: 'turn.start' }, ctx)).toEqual([]);
  });
});
