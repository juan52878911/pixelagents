import { afterEach, describe, expect, it } from 'vitest';
import type { Entity } from '@pixelagents/protocol';
import { decayIntensity, INTENSITY_DECAY, INTENSITY_HOLD_SEC } from '../src/reducer.js';
import { ev, start, stopAll } from './helpers.js';

afterEach(stopAll);

describe('turn state, errors, tokens, waits, forks and intensity', () => {
  it('tracks the turn in progress and closes it with usage', async () => {
    const c = await start(4400);
    const s = c.server;
    const A = 'agent:a';
    const get = (): Entity => s.snapshot().entities.find((e) => e.id === A)!;

    s.ingest(ev(c.clock, A, 'session.start', { model: 'claude-sonnet', source: 'resume' }));
    expect(get().history.at(-1)!.summary).toBe('session started (resume)');
    expect(get().turn).toBeUndefined();

    c.clock.advance(1);
    s.ingest(ev(c.clock, A, 'turn.start'));
    const since = new Date(c.clock.t).toISOString();
    expect(get().turn).toEqual({ since, n: 1, tools: 0, errors: 0, forks: 0 });
    expect(get().metrics).toMatchObject({ turns: 1, turn_ms: 0 });

    c.clock.advance(2);
    s.ingest(ev(c.clock, A, 'tool.pre', { tool: 'Bash', detail: 'npm test' }));
    c.clock.advance(1);
    s.ingest(ev(c.clock, A, 'tool.post', { tool: 'Bash', ok: false, error: 'exit 1' }));
    expect(get().turn).toMatchObject({ tools: 1, errors: 1 });
    expect(get().metrics).toMatchObject({ tools: 1, errors: 1, error_streak: 1 });
    expect(get().history.at(-1)!.summary).toBe('Bash failed (exit 1)');

    c.clock.advance(1);
    s.ingest(ev(c.clock, A, 'tool.pre', { tool: 'Read', detail: 'a.ts' }));
    s.ingest(ev(c.clock, A, 'tool.post', { tool: 'Read' }));
    expect(get().metrics).toMatchObject({ tools: 2, errors: 1, error_streak: 0 });

    c.clock.advance(5);
    s.ingest(ev(c.clock, A, 'turn.end', { usage: { input: 100, output: 400, cache_read: 9000, cache_write: 50 }, steps: 3, context_tokens: 9150, model: 'claude-sonnet-4-6', effort: 'high' }));
    const e = get();
    expect(e.status).toBe('idle');
    expect(e.turn).toMatchObject({ n: 1, tools: 2, errors: 1, until: new Date(c.clock.t).toISOString() });
    expect(e.metrics).toMatchObject({
      turn_ms: 9000, turn_tools: 2, turn_steps: 3, tokens_in: 100, tokens_out: 400, tokens_cache_read: 9000, tokens_cache_write: 50,
      turn_tokens_out: 400, turn_tokens_in: 9150, context_tokens: 9150,
    });
    expect(e.labels).toMatchObject({ model: 'claude-sonnet-4-6', effort: 'high' });
    expect(e.history.at(-1)!.summary).toBe('turn finished (3 steps, 400 tok out)');

    // the source's own duration wins over the clock, tokens accumulate
    c.clock.advance(1);
    s.ingest(ev(c.clock, A, 'turn.start'));
    c.clock.advance(3);
    s.ingest(ev(c.clock, A, 'turn.end', { usage: { output: 100 }, duration_ms: 1234 }));
    expect(get().metrics).toMatchObject({ turns: 2, turn_ms: 1234, tokens_out: 500, turn_tokens_out: 100, turn_tools: 0 });
    expect(get().turn!.n).toBe(2);
  });

  it('compactions and tool failures without a turn', async () => {
    const c = await start(4401);
    const A = 'agent:b';
    const get = (): Entity => c.server.snapshot().entities.find((e) => e.id === A)!;
    c.server.ingest(ev(c.clock, A, 'compact', { trigger: 'auto' }));
    expect(get().metrics.compactions).toBe(1);
    expect(get().history.at(-1)!.summary).toBe('context compacted (auto)');
    c.server.ingest(ev(c.clock, A, 'tool.pre', { tool: 'Bash' }));
    expect(get().turn).toMatchObject({ n: 0, tools: 1 }); // implicit turn for sources without turn events
    c.server.ingest(ev(c.clock, A, 'tool.post', { tool: 'Bash', ok: false }));
    expect(get().metrics).toMatchObject({ errors: 1, error_streak: 1, tools: 1 });
  });

  it('measures how long a permission wait took, however it ends', async () => {
    const c = await start(4402);
    const s = c.server;
    const A = 'agent:w';
    const get = (): Entity => s.snapshot().entities.find((e) => e.id === A)!;
    s.ingest(ev(c.clock, A, 'waiting.permission', { tool: 'Bash' }));
    expect(get().metrics.waits).toBe(1);
    c.clock.advance(7);
    s.ingest(ev(c.clock, A, 'tool.post', { tool: 'Bash' }));
    expect(get().status).toBe('working');
    expect(get().metrics).toMatchObject({ wait_ms_last: 7000, wait_ms_total: 7000 });

    s.ingest(ev(c.clock, A, 'waiting.permission', { tool: 'Edit' }));
    c.clock.advance(3);
    s.ingest(ev(c.clock, A, 'tool.pre', { tool: 'Edit' }));
    expect(get().metrics).toMatchObject({ wait_ms_last: 3000, wait_ms_total: 10000, waits: 2 });

    // a source that reports the wait itself (nod permission.decision)
    s.ingest(ev(c.clock, A, 'waiting.permission', { tool: 'Read' }));
    c.clock.advance(1);
    s.ingest(ev(c.clock, A, 'state', { status: 'working', wait_ms: 2400 }));
    expect(get().metrics).toMatchObject({ wait_ms_last: 2400, wait_ms_total: 12400 });

    s.ingest(ev(c.clock, A, 'waiting.human'));
    c.clock.advance(2);
    s.ingest(ev(c.clock, A, 'turn.end'));
    expect(get().metrics).toMatchObject({ wait_ms_last: 2000, wait_ms_total: 14400, waits: 4 });
  });

  it('parents count their live subagents and forks per turn', async () => {
    const c = await start(4403);
    const s = c.server;
    const P = 'agent:p';
    const get = (id: string): Entity => s.snapshot().entities.find((e) => e.id === id)!;
    s.ingest(ev(c.clock, P, 'turn.start'));
    s.ingest(ev(c.clock, 'subagent:p-1', 'fork.start', { agent_type: 'Explore' }, { parent: P }));
    s.ingest(ev(c.clock, 'subagent:p-2', 'fork.start', {}, { parent: P }));
    expect(get(P).metrics).toMatchObject({ subagents_live: 2, forks: 2 });
    expect(get(P).turn).toMatchObject({ forks: 2 });
    expect(get('subagent:p-1').labels.agent_type).toBe('Explore');
    expect(get('subagent:p-1').history.at(-1)!.summary).toBe('subagent started (Explore)');
    c.clock.advance(2);
    s.ingest(ev(c.clock, 'subagent:p-1', 'fork.end', { usage: { output: 50 }, duration_ms: 2000 }, { parent: P }));
    expect(get(P).metrics).toMatchObject({ subagents_live: 1, forks: 2 });
    expect(get('subagent:p-1').metrics).toMatchObject({ tokens_out: 50, turn_ms: 2000 });
    s.ingest(ev(c.clock, 'subagent:p-2', 'fork.end', {}, { parent: P }));
    expect(get(P).metrics.subagents_live).toBe(0);
  });

  it('intensity follows the tool rate and fades when quiet', async () => {
    const c = await start(4404);
    const s = c.server;
    const A = 'agent:i';
    const get = (): Entity => s.snapshot().entities.find((e) => e.id === A)!;
    s.ingest(ev(c.clock, A, 'turn.start'));
    s.ingest(ev(c.clock, A, 'tool.pre', { tool: 'Read' }));
    expect(get().metrics.intensity).toBeUndefined(); // one call: no rate yet
    for (let i = 0; i < 6; i++) {
      c.clock.advance(2); // 30 tools/min
      s.ingest(ev(c.clock, A, 'tool.pre', { tool: 'Read' }));
    }
    expect(get().metrics.intensity).toBe(100);
    expect(get().metrics.tools_per_min).toBeGreaterThan(20);
    const hot = get().metrics.intensity!;

    // still working and recently active: no decay
    c.clock.advance(5);
    s.tick();
    expect(get().metrics.intensity).toBe(hot);
    // quiet for longer than the hold: fades by INTENSITY_DECAY per tick
    c.clock.advance(INTENSITY_HOLD_SEC);
    s.tick();
    expect(get().metrics.intensity).toBe(hot - INTENSITY_DECAY);
    // idle fades regardless of the hold
    s.ingest(ev(c.clock, A, 'turn.end'));
    const before = get().metrics.intensity!;
    s.tick();
    expect(get().metrics.intensity).toBe(before - INTENSITY_DECAY);

    const e: Entity = { ...get(), metrics: { intensity: 2, tools_per_min: 9 } };
    expect(decayIntensity(e, c.clock.t + 60000)).toBe(true);
    expect(e.metrics).toEqual({ intensity: 0, tools_per_min: 0 });
    expect(decayIntensity(e, c.clock.t)).toBe(false);
  });

  it('slow tool calls give a low intensity', async () => {
    const c = await start(4405);
    const A = 'agent:slow';
    for (let i = 0; i < 4; i++) {
      c.clock.advance(30); // 2 tools/min
      c.server.ingest(ev(c.clock, A, 'tool.pre', { tool: 'Bash' }));
    }
    const m = c.server.snapshot().entities.find((e) => e.id === A)!.metrics;
    expect(m.intensity).toBeGreaterThan(0);
    expect(m.intensity).toBeLessThan(30);
  });
});
