import type { PaConfig } from './config.js';

/** Works out of the box for one machine running Claude Code with the hooks installed. */
export const DEFAULT_CONFIG: PaConfig = {
  version: 1,
  server: { host: '127.0.0.1', port: 4242 },
  inputs: [
    { id: 'local', type: 'file', path: '~/.pixelagents/events.jsonl', adapter: 'claude-code' },
    { id: 'http', type: 'http', adapter: 'claude-code' },
  ],
  plugins: ['@pixelagents/plugin-claude-code', '@pixelagents/plugin-pop'],
  classify: [
    // Hosts and accounts carry numbers (load, quota, spend) for the offices' gauges; they are not NPCs.
    { name: 'metrics-only entities', match: { kind: ['host', 'account'] }, set: { 'view.hidden': true } },
    { name: 'subagents are minions', match: { kind: 'subagent' }, set: { 'view.behavior': 'minion' } },
    { name: 'skin by account', match: { 'labels.account': '*' }, set: { 'view.skin': '{{labels.account}}' } },
  ],
  groups: { by: '{{labels.host}}', label: '{{labels.host}}', kinds: { '*': 'office' }, zones: '{{labels.repo}}' },
  behaviors: {
    default: {
      starting: 'arrive',
      working: 'type',
      thinking: 'think',
      waiting: 'wait',
      idle: 'idle',
      sleeping: 'sleep',
      ended: 'leave',
      '*': 'idle',
    },
    minion: { '*': 'minion', ended: 'poof' },
  },
  skins: {
    default: { palette: { B: '#3b7dd8', b: '#2756a3' } },
  },
  world: {
    generator: 'town',
    seed: 'daily',
    strategies: [],
    season: 'auto',
    width: 480,
    height: 328,
    fps: 60,
    builders: true,
  },
  assets: [],
  effects: [],
  fun: { decor: true, gags: true, emojis: true, everySec: 8 },
  timing: { sleepAfterSec: 300, forgetAfterSec: 3600, endedLingerSec: 8, historyMax: 50 },
  pluginConfig: {},
};

/** Deep merge for config layers: objects merge, arrays and scalars replace. */
export function mergeConfig<T>(base: T, over: unknown): T {
  if (over === undefined) return base;
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== 'object' || base === null || typeof over !== 'object' || over === null) {
    return over as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = mergeConfig(out[k], v);
  return out as T;
}
