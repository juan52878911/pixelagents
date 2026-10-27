import { definePlugin, type Adapter, type PaEvent } from '@pixelagents/protocol';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** Reads HookLine v1 and the legacy line shape (same fields, no `v`). Only whitelisted fields are read. */
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
    const labels: Record<string, string> = {};
    for (const k of ['account', 'host', 'repo', 'branch', 'model', 'agent'] as const) {
      const v = str(l[k]);
      if (v) labels[k] = v;
    }
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
    if (Object.keys(attrs).length) ev.attrs = attrs;
    return [ev];
  },
};

export default definePlugin({ name: 'claude-code', adapters: [claudeCodeAdapter] });
