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
    expect(plugin.reducers?.map((r) => r.name)).toEqual(['claude-code']);
  });

  it('v1 fixture: 186 events over 8 entities', () => {
    const evs = run('claude-code.v1.jsonl');
    expect(evs).toHaveLength(186);
    expect(new Set(evs.map((e) => e.entity))).toEqual(
      new Set(['agent:s-laptop-2', 'agent:s-vm-1', 'agent:s-laptop-1', 'agent:s-ws-1',
        'subagent:s-laptop-1-sub2', 'subagent:s-laptop-2-sub2', 'subagent:s-vm-1-sub2', 'subagent:s-ws-1-sub2']),
    );
    expect(evs.every((e) => e.source === 'local')).toBe(true);
  });

  it('legacy fixture: 178 events over 4 entities, same kinds and tools as v1', () => {
    const evs = run('claude-code.legacy.jsonl');
    expect(evs).toHaveLength(178);
    expect(new Set(evs.map((e) => e.entity)).size).toBe(4);
    const v1 = run('claude-code.v1.jsonl').filter((e) => e.entity === 'agent:s-laptop-2');
    const legacy = evs.filter((e) => e.entity === 'agent:s-laptop-2');
    expect(legacy.map((e) => [e.ts, e.kind, e.attrs?.tool, e.attrs?.detail])).toEqual(v1.map((e) => [e.ts, e.kind, e.attrs?.tool, e.attrs?.detail]));
    // legacy `source: 'claude-code'` is the input name, not a SessionStart source
    expect(legacy.find((e) => e.kind === 'session.start')!.attrs).toEqual({ model: 'claude-sonnet' });
  });

  it('labels carry account, host, repo, branch, agent', () => {
    const start = run('claude-code.v1.jsonl').find((e) => e.entity === 'agent:s-laptop-2' && e.kind === 'session.start')!;
    expect(start.labels).toEqual({ account: 'work', host: 'laptop', repo: 'api', branch: 'main', model: 'claude-sonnet', agent: 'dev', permission_mode: 'default' });
    expect(start.attrs).toEqual({ model: 'claude-sonnet', source: 'startup' });
  });

  it('subagents get their own entity with parent, type and usage', () => {
    const fork = run('claude-code.v1.jsonl').filter((e) => e.entity === 'subagent:s-laptop-2-sub2');
    expect(fork.map((e) => e.kind)).toEqual(['fork.start', 'fork.end']);
    expect(fork.every((e) => e.parent === 'agent:s-laptop-2')).toBe(true);
    expect(fork[0]!.attrs).toEqual({ agent_type: 'Explore' });
    expect(fork[0]!.labels!.agent_type).toBe('Explore');
    expect(fork[1]!.attrs).toEqual({ usage: { input: 50, output: 400, cache_read: 3000, cache_write: 0 }, steps: 2, context_tokens: 3050, duration_ms: 1900, model: 'claude-haiku' });
  });

  it('turn.end carries usage, steps, context, duration, model and effort', () => {
    const end = run('claude-code.v1.jsonl').find((e) => e.kind === 'turn.end')!;
    expect(end.attrs).toMatchObject({ steps: expect.any(Number), context_tokens: expect.any(Number), duration_ms: expect.any(Number), model: 'claude-sonnet', effort: 'high' });
    expect(end.attrs!.usage).toMatchObject({ input: expect.any(Number), output: expect.any(Number), cache_read: 12000, cache_write: 400 });
  });

  it('failed tools, compactions and session end reasons', () => {
    const evs = run('claude-code.v1.jsonl');
    const fail = evs.find((e) => e.kind === 'tool.post' && e.attrs?.ok === false)!;
    expect(fail.attrs).toEqual({ tool: 'Bash', ok: false, error: 'exit 1', duration_ms: 300 });
    const ok = evs.find((e) => e.kind === 'tool.post' && e.attrs?.ok !== false)!;
    expect(ok.attrs).toMatchObject({ duration_ms: expect.any(Number) });
    expect(ok.attrs!.ok).toBeUndefined();
    expect(evs.find((e) => e.kind === 'compact')!.attrs).toEqual({ trigger: 'auto' });
    expect(evs.find((e) => e.kind === 'session.end')!.attrs).toEqual({ reason: 'prompt_input_exit' });
  });

  it('never leaks SECRET from any fixture line', () => {
    const junk = { v: 1, session: 's', kind: 'turn.end', ts: 't', prompt: 'SECRET', answer: 'SECRET', error: 'SECRET message', usage: { input: 1, text: 'SECRET' } };
    expect(JSON.stringify(claudeCodeAdapter.parse(junk, ctx))).not.toContain('SECRET');
    expect(JSON.stringify(run('claude-code.v1.jsonl'))).not.toContain('SECRET');
  });

  it('tool events carry tool and detail', () => {
    const pre = run('claude-code.v1.jsonl').find((e) => e.kind === 'tool.pre')!;
    expect(pre.attrs).toMatchObject({ tool: 'Grep', detail: 'useState' });
  });

  it('ignores junk and other kinds', () => {
    expect(claudeCodeAdapter.parse('x', ctx)).toEqual([]);
    expect(claudeCodeAdapter.parse({ session: 's', kind: 'other', ts: 't' }, ctx)).toEqual([]);
    expect(claudeCodeAdapter.parse({ kind: 'turn.start' }, ctx)).toEqual([]);
  });
});
