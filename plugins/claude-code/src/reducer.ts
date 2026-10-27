import type { Reducer, TokenUsage } from '@pixelagents/protocol';

/**
 * List prices in USD per million tokens [input, output, cache read]; cache writes cost 1.25× input.
 * Matched by substring on the model id, first match wins (most specific first). An estimate: the
 * metric is `cost_est_usd`, separate from `cost_usd` reported by sources that know the real figure.
 */
export const PRICES: [string, number, number, number][] = [
  ['fable-5-1', 10, 50, 0.25], ['mythos-5-1', 10, 50, 0.25], ['fable-5', 10, 50, 1], ['mythos', 10, 50, 1],
  ['opus-5-5', 4, 20, 0.2], ['opus-5', 5, 25, 0.5], ['opus-4-8', 5, 25, 0.5], ['opus-4-7', 5, 25, 0.5], ['opus-4-6', 5, 25, 0.5], ['opus-4-5', 5, 25, 0.5],
  ['opus-4', 15, 75, 1.5], ['opus-3', 15, 75, 1.5], ['opus', 5, 25, 0.5],
  ['sonnet-5', 2, 10, 0.2], ['sonnet-4', 3, 15, 0.3], ['sonnet-3', 3, 15, 0.3], ['sonnet', 3, 15, 0.3],
  ['haiku-5', 0.1, 0.5, 0.01], ['haiku-4', 1, 5, 0.1], ['haiku-3-5', 0.8, 4, 0.08], ['haiku-3', 0.25, 1.25, 0.03], ['haiku', 1, 5, 0.1],
];

/** USD of a usage block for a model id, or undefined when the model is unknown. */
export function costOf(model: string | undefined, u: TokenUsage): number | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  const row = PRICES.find(([k]) => m.includes(k));
  if (!row) return undefined;
  const [, inp, out, cr] = row;
  const usd = ((u.input ?? 0) * inp + (u.output ?? 0) * out + (u.cache_read ?? 0) * cr + (u.cache_write ?? 0) * inp * 1.25) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Estimates the cost of each turn from its token usage and the model (claude-code sessions have no cost source). */
export const claudeCodeReducer: Reducer = {
  name: 'claude-code',
  kinds: ['turn.end', 'fork.end'],
  reduce(e, ev) {
    const a = ev.attrs ?? {};
    const u = obj(a.usage);
    if (!u) return e;
    const usage: TokenUsage = { input: num(u.input), output: num(u.output), cache_read: num(u.cache_read), cache_write: num(u.cache_write) };
    const usd = costOf(typeof a.model === 'string' ? a.model : e.labels.model, usage);
    if (usd === undefined) return e;
    e.metrics.cost_turn_usd = usd;
    e.metrics.cost_est_usd = Math.round(((e.metrics.cost_est_usd ?? 0) + usd) * 1e6) / 1e6;
    return e;
  },
};
