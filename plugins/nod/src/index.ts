import { definePlugin, type Adapter, type PaEvent, type TokenUsage } from '@pixelagents/protocol';

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v != null && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** nod usage `{input, output, cache_read, cache_write, model}` → TokenUsage (numbers only). */
function usageOf(v: unknown): TokenUsage | undefined {
  const u = obj(v);
  const out: TokenUsage = {};
  for (const k of ['input', 'output', 'cache_read', 'cache_write'] as const) {
    const n = num(u[k]);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * nod envelopes `{nod, source, events[]}`. Privacy: never reads prompt.submit.data.text,
 * turn.end.data.answer or tool.call.data.input; only whitelisted fields are copied.
 */
/** Effort level of the last turn.step per session (bounded: sessions are few). */
const lastEffort = new Map<string, string>();

export const nodAdapter: Adapter = {
  name: 'nod',
  parse(raw, ctx) {
    const env = obj(raw);
    if (!Array.isArray(env.events)) return [];
    const source = obj(env.source);
    const profile = str(source.profile);
    const accountMap = obj(ctx.options.accountMap);
    const account = (profile && str(accountMap[profile])) || profile;
    const host = str(source.machine);
    const out: PaEvent[] = [];
    for (const e of env.events) {
      const x = obj(e);
      const session = str(x.session);
      const type = str(x.type);
      const t = num(x.ts);
      if (!session || !type || t === undefined) continue;
      const data = obj(x.data);
      const ts = new Date(t).toISOString();
      const entity = `agent:${session}`;
      const labels: Record<string, string> = {};
      if (account) labels.account = account;
      if (host) labels.host = host;
      const mk = (kind: string, attrs?: Rec, extra?: Partial<PaEvent>): PaEvent => {
        const ev: PaEvent = { ts, source: ctx.input, entity, kind, labels: { ...labels }, ...extra };
        if (attrs && Object.keys(attrs).length) ev.attrs = attrs;
        return ev;
      };
      switch (type) {
        case 'session.start': {
          const repo = obj(data.repo);
          const root = str(repo.root);
          const model = str(data.model);
          const ev = mk('session.start', model ? { model, source: 'startup' } : { source: 'startup' });
          if (root) ev.labels!.repo = root.replace(/\/+$/, '').split('/').pop()!;
          const branch = str(repo.branch);
          if (branch) ev.labels!.branch = branch;
          if (model) ev.labels!.model = model;
          out.push(ev);
          break;
        }
        case 'session.end': {
          const attrs: Rec = {};
          if (str(data.reason)) attrs.reason = str(data.reason)!.slice(0, 40);
          out.push(mk('session.end', attrs));
          break;
        }
        case 'turn.start':
          out.push(mk('turn.start'));
          break;
        case 'turn.end': {
          const attrs: Rec = {};
          const usage = usageOf(data.usage);
          if (usage) attrs.usage = usage;
          if (num(data.duration_ms) !== undefined) attrs.duration_ms = num(data.duration_ms);
          if (num(data.steps) !== undefined) attrs.steps = num(data.steps);
          if (str(data.outcome)) attrs.outcome = str(data.outcome)!.slice(0, 20);
          const model = str(obj(data.usage).model);
          if (model) attrs.model = model.slice(0, 80);
          if (lastEffort.has(session)) attrs.effort = lastEffort.get(session);
          out.push(mk('turn.end', attrs));
          break;
        }
        case 'tool.call': {
          const tool = str(data.tool);
          if (tool) out.push(mk('tool.pre', { tool }));
          break;
        }
        case 'tool.result': {
          const tool = str(data.tool);
          if (!tool) break;
          const attrs: Rec = { tool };
          if (typeof data.ok === 'boolean') attrs.ok = data.ok;
          if (data.rejected === true) { attrs.ok = false; attrs.error = 'rejected'; }
          if (num(data.duration_ms) !== undefined) attrs.duration_ms = num(data.duration_ms);
          out.push(mk('tool.post', attrs));
          break;
        }
        case 'permission.request': {
          const tool = str(data.tool);
          out.push(mk('waiting.permission', tool ? { tool } : undefined));
          break;
        }
        case 'permission.decision': {
          const attrs: Rec = { status: 'working' };
          if (num(data.wait_ms) !== undefined) attrs.wait_ms = num(data.wait_ms);
          if (str(data.decision)) attrs.reason = str(data.decision)!.slice(0, 20);
          out.push(mk('state', attrs));
          break;
        }
        case 'agent.spawn':
        case 'agent.end': {
          const agent = str(data.agent);
          if (!agent) break;
          const kind = type === 'agent.spawn' ? 'fork.start' : 'fork.end';
          const attrs: Rec = {};
          if (kind === 'fork.start') {
            if (str(data.type)) attrs.agent_type = str(data.type)!.slice(0, 60);
            if (str(data.model)) attrs.model = str(data.model)!.slice(0, 80);
          } else {
            const usage = usageOf(data.usage);
            if (usage) attrs.usage = usage;
            if (num(data.duration_ms) !== undefined) attrs.duration_ms = num(data.duration_ms);
            const model = str(obj(data.usage).model);
            if (model) attrs.model = model.slice(0, 80);
          }
          out.push(mk(kind, attrs, { entity: `subagent:${session}-${agent}`, parent: entity }));
          break;
        }
        case 'usage': {
          const attrs: Rec = {};
          const cost = num(data.cost_usd);
          if (cost !== undefined) attrs.cost_usd = cost;
          const pct = num(obj(data.context).percent);
          if (pct !== undefined) attrs.context_pct = pct;
          if (Array.isArray(data.limits)) {
            for (const lim of data.limits) {
              const li = obj(lim);
              const p = num(li.percent);
              if (p === undefined) continue;
              if (li.kind === 'five_hour') attrs.limit_5h_pct = p;
              else if (li.kind === 'seven_day') attrs.limit_7d_pct = p;
            }
          }
          if (Object.keys(attrs).length) out.push(mk('metric', attrs));
          break;
        }
        case 'turn.step': {
          // Only the effort enum is kept, attached to the turn.end of the same session.
          const effort = str(data.effort);
          if (effort) lastEffort.set(session, effort.slice(0, 20));
          break;
        }
        default:
          break; // prompt.submit, job.*, … are not needed
      }
    }
    return out;
  },
};

export default definePlugin({ name: 'nod', adapters: [nodAdapter] });
