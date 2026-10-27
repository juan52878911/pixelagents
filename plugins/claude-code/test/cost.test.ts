import { describe, expect, it } from 'vitest';
import type { Entity, PaEvent } from '@pixelagents/protocol';
import { DEFAULT_CONFIG } from '@pixelagents/protocol';
import { claudeCodeReducer, costOf } from '../src/reducer.js';

const ent = (labels: Record<string, string> = {}): Entity => ({
  id: 'agent:x', kind: 'agent', labels, status: 'idle', metrics: {}, firstSeen: 't', lastSeen: 't', history: [], view: {},
});
const ctx = { config: DEFAULT_CONFIG, now: () => new Date(0), get: () => undefined };
const turn = (attrs: Record<string, unknown>): PaEvent => ({ ts: '2026-01-01T00:00:00Z', source: 's', entity: 'agent:x', kind: 'turn.end', attrs });

describe('claude-code cost estimate', () => {
  it('prices by model family, most specific first', () => {
    const u = { input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, cache_write: 1_000_000 };
    expect(costOf('claude-sonnet-4-6', u)).toBe(3 + 15 + 0.3 + 3.75);
    expect(costOf('claude-opus-5-5', u)).toBe(4 + 20 + 0.2 + 5);
    expect(costOf('claude-opus-4-1-20250805', u)).toBe(15 + 75 + 1.5 + 18.75);
    expect(costOf('claude-haiku-5-5', u)).toBe(0.1 + 0.5 + 0.01 + 0.125);
    expect(costOf('claude-haiku', { output: 2000 })).toBe(0.01);
    expect(costOf('gpt-9', u)).toBeUndefined();
    expect(costOf(undefined, u)).toBeUndefined();
  });

  it('accumulates cost_est_usd per turn, separate from cost_usd', () => {
    const e = ent({ model: 'claude-sonnet-4-6' });
    e.metrics.cost_usd = 9;
    claudeCodeReducer.reduce(e, turn({ usage: { input: 1000, output: 1000 } }), ctx);
    expect(e.metrics).toMatchObject({ cost_turn_usd: 0.018, cost_est_usd: 0.018, cost_usd: 9 });
    // attrs.model wins over the label
    claudeCodeReducer.reduce(e, turn({ usage: { output: 1000 }, model: 'claude-haiku-4-5' }), ctx);
    expect(e.metrics).toMatchObject({ cost_turn_usd: 0.005, cost_est_usd: 0.023 });
    // no usage or unknown model: untouched
    claudeCodeReducer.reduce(e, turn({}), ctx);
    claudeCodeReducer.reduce(e, turn({ usage: { output: 1 }, model: 'mystery' }), ctx);
    expect(e.metrics.cost_est_usd).toBe(0.023);
  });
});
