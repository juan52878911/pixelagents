import { definePlugin, type Adapter, type PaEvent, type TokenUsage } from '@pixelagents/protocol';
import { claudeCodeReducer } from './reducer.js';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function usageOf(v: unknown): TokenUsage | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const u = v as Record<string, unknown>;
  const out: TokenUsage = {};
  for (const k of ['input', 'output', 'cache_read', 'cache_write'] as const) {
    const n = num(u[k]);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Reads HookLine v1 and the legacy line shape (same fields, no `v`). Only whitelisted fields are read:
 * identifiers, tool names, short details, enums and numbers. No text ever reaches an event.
 */
export const claudeCodeAdapter: Adapter = {
  name: 'claude-code',
  parse(raw, ctx) {
    if (raw == null || typeof raw !== 'object') return [];
    const l = raw as Record<string, unknown>;
    const session = str(l.session);
    const kind = str(l.kind);
    const ts = str(l.ts);
    if (!session || !kind || !ts || kind === 'other') return [];
    const parent = str(l.parent);
    const v1 = l.v === 1; // legacy lines carry `source: 'claude-code'`, not the SessionStart source
    const labels: Record<string, string> = {};
    for (const k of ['account', 'host', 'repo', 'branch', 'model', 'agent'] as const) {
      const v = str(l[k]);
      if (v) labels[k] = v;
    }
    const pm = str(l.permissionMode);
    if (pm) labels.permission_mode = pm;
    const effort = str(l.effort);
    if (effort) labels.effort = effort;
    const agentType = str(l.agentType);
    if (agentType) labels.agent_type = agentType;
    const ev: PaEvent = {
      ts,
      source: ctx.input,
      entity: parent ? `subagent:${session}` : `agent:${session}`,
      kind,
      labels,
    };
    if (parent) ev.parent = `agent:${parent}`;
    const attrs: Record<string, unknown> = {};
    const tool = str(l.tool);
    const detail = str(l.detail);
    const model = str(l.model);
    if (tool) attrs.tool = tool;
    if (detail) attrs.detail = detail.slice(0, 120);
    if (kind === 'session.start' && model) attrs.model = model;
    if (kind === 'session.start' || kind === 'fork.start') {
      if (v1 && str(l.source)) attrs.source = str(l.source);
      if (agentType) attrs.agent_type = agentType;
    }
    if (kind === 'compact' && v1 && str(l.source)) attrs.trigger = str(l.source);
    if (kind === 'session.end' && str(l.reason)) attrs.reason = str(l.reason);
    if (kind === 'tool.post') {
      if (l.ok === false) attrs.ok = false;
      if (str(l.error)) attrs.error = str(l.error)!.slice(0, 40);
      if (num(l.durationMs) !== undefined) attrs.duration_ms = num(l.durationMs);
    }
    if (kind === 'turn.end' || kind === 'fork.end') {
      const usage = usageOf(l.usage);
      if (usage) attrs.usage = usage;
      if (num(l.steps) !== undefined) attrs.steps = num(l.steps);
      if (num(l.contextTokens) !== undefined) attrs.context_tokens = num(l.contextTokens);
      if (num(l.turnMs) !== undefined) attrs.duration_ms = num(l.turnMs);
      if (str(l.usageModel)) attrs.model = str(l.usageModel);
      if (effort) attrs.effort = effort;
    }
    if (Object.keys(attrs).length) ev.attrs = attrs;
    return [ev];
  },
};

export default definePlugin({ name: 'claude-code', adapters: [claudeCodeAdapter], reducers: [claudeCodeReducer] });
