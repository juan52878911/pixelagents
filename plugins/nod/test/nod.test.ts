import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PaEvent } from '@pixelagents/protocol';
import { nodAdapter } from '../src/index.js';
import { claudeCodeAdapter } from '../../claude-code/src/index.js';

const lines = (n: string) =>
  readFileSync(new URL('../../../fixtures/' + n, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const mk = (options: Record<string, unknown> = {}) => ({ input: 'nod', options, now: () => new Date('2026-01-15T10:00:00Z') });
const run = (options: Record<string, unknown> = {}): PaEvent[] => lines('nod.events.jsonl').flatMap((l) => nodAdapter.parse(l, mk(options)));

describe('nod adapter', () => {
  it('fixture: 82 events over 6 entities (prompt.submit and turn.step dropped)', () => {
    const evs = run();
    expect(evs).toHaveLength(82);
    expect(new Set(evs.map((e) => e.entity))).toEqual(
      new Set([
        'agent:s-laptop-1', 'agent:s-laptop-2', 'agent:s-ws-1',
        'subagent:s-laptop-1-sub-a', 'subagent:s-laptop-2-sub-a', 'subagent:s-ws-1-sub-a',
      ]),
    );
  });

  it('maps kinds', () => {
    const c: Record<string, number> = {};
    for (const e of run()) c[e.kind] = (c[e.kind] ?? 0) + 1;
    expect(c).toEqual({
      'session.start': 3, 'session.end': 1, 'turn.start': 6, 'turn.end': 6, 'tool.pre': 18, 'tool.post': 18,
      'waiting.permission': 9, state: 9, 'fork.start': 3, 'fork.end': 3, metric: 6,
    });
  });

  it('labels: account via accountMap, host from machine, repo/branch from session.start', () => {
    const evs = run({ accountMap: { claude: 'personal' } });
    const s = evs.find((e) => e.entity === 'agent:s-laptop-1' && e.kind === 'session.start')!;
    expect(s.labels).toEqual({ account: 'personal', host: 'laptop', repo: 'web-app', branch: 'main', model: 'claude-sonnet' });
    expect(evs.find((e) => e.entity === 'agent:s-ws-1')!.labels).toMatchObject({ account: 'work', host: 'workstation' });
    expect(run().find((e) => e.entity === 'agent:s-laptop-1')!.labels!.account).toBe('claude');
  });

  it('usage becomes metrics', () => {
    const m = run().find((e) => e.kind === 'metric' && e.entity === 'agent:s-laptop-1')!;
    expect(m.attrs).toEqual({ cost_usd: 1.1269, context_pct: 21, limit_5h_pct: 33, limit_7d_pct: 7 });
  });

  it('permission, tools and forks', () => {
    const evs = run();
    expect(evs.find((e) => e.kind === 'tool.pre')!.attrs).toEqual({ tool: 'Bash' });
    expect(evs.find((e) => e.kind === 'tool.post')!.attrs).toEqual({ tool: 'Bash', ok: true, duration_ms: 120 });
    expect(evs.find((e) => e.kind === 'waiting.permission')!.attrs).toEqual({ tool: expect.any(String) });
    expect(evs.find((e) => e.kind === 'state')!.attrs).toEqual({ status: 'working', wait_ms: 2400, reason: 'allow' });
    const f = evs.find((e) => e.kind === 'fork.start')!;
    expect(f.parent).toBe(f.entity.replace(/^subagent:(.+)-sub-a$/, 'agent:$1'));
  });

  it('turn.end carries usage, duration, steps, model and the effort of the last step', () => {
    const end = run().find((e) => e.kind === 'turn.end')!;
    expect(end.attrs).toEqual({ usage: { input: 100, output: 50, cache_read: 900, cache_write: 10 }, duration_ms: 9000, steps: 3, outcome: 'done', model: 'claude-sonnet', effort: 'medium' });
    const evs = run();
    expect(evs.find((e) => e.kind === 'fork.start')!.attrs).toEqual({ agent_type: 'Explore', model: 'claude-haiku' });
    expect(evs.find((e) => e.kind === 'fork.end')!.attrs).toEqual({ usage: { input: 10, output: 20, cache_read: 0, cache_write: 0 }, duration_ms: 9000, model: 'claude-haiku' });
    expect(evs.find((e) => e.kind === 'session.end')!.attrs).toEqual({ reason: 'exit' });
    expect(evs.find((e) => e.kind === 'session.start')!.attrs).toEqual({ model: 'claude-sonnet', source: 'startup' });
  });

  it('merges with claude-code on the same entity id', () => {
    const nodIds = new Set(run().map((e) => e.entity));
    const cc = lines('claude-code.v1.jsonl').flatMap((l) => claudeCodeAdapter.parse(l, mk()));
    const shared = [...new Set(cc.map((e) => e.entity))].filter((id) => nodIds.has(id));
    expect(shared.sort()).toEqual(['agent:s-laptop-1', 'agent:s-laptop-2', 'agent:s-ws-1']);
    const a = run().find((e) => e.entity === 'agent:s-laptop-2' && e.kind === 'session.start')!;
    const b = cc.find((e) => e.entity === 'agent:s-laptop-2' && e.kind === 'session.start')!;
    expect(a.labels).toMatchObject({ account: b.labels!.account, host: b.labels!.host, repo: b.labels!.repo, branch: b.labels!.branch });
  });

  it('never leaks prompt, answer or tool input', () => {
    expect(JSON.stringify(run())).not.toContain('SECRET');
    expect(JSON.stringify(run())).not.toContain('MUST NOT LEAK');
  });

  it('ignores junk', () => {
    expect(nodAdapter.parse('x', mk())).toEqual([]);
    expect(nodAdapter.parse({ events: [{ type: 'turn.start' }] }, mk())).toEqual([]);
  });
});
