import { definePlugin, type Adapter, type PaEvent } from '@pixelagents/protocol';

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v != null && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * nod envelopes `{nod, source, events[]}`. Privacy: never reads prompt.submit.data.text,
 * turn.end.data.answer or tool.call.data.input; only whitelisted fields are copied.
 */
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
          const ev = mk('session.start', model ? { model } : undefined);
          if (root) ev.labels!.repo = root.replace(/\/+$/, '').split('/').pop()!;
          const branch = str(repo.branch);
          if (branch) ev.labels!.branch = branch;
          if (model) ev.labels!.model = model;
          out.push(ev);
          break;
        }
        case 'turn.start':
          out.push(mk('turn.start'));
          break;
        case 'turn.end':
          out.push(mk('turn.end'));
          break;
        case 'tool.call': {
          const tool = str(data.tool);
          if (tool) out.push(mk('tool.pre', { tool }));
          break;
        }
        case 'tool.result': {
          const tool = str(data.tool);
          if (tool) out.push(mk('tool.post', typeof data.ok === 'boolean' ? { tool, ok: data.ok } : { tool }));
          break;
        }
        case 'permission.request': {
          const tool = str(data.tool);
          out.push(mk('waiting.permission', tool ? { tool } : undefined));
          break;
        }
        case 'permission.decision':
          out.push(mk('state', { status: 'working' }));
          break;
        case 'agent.spawn':
        case 'agent.end': {
          const agent = str(data.agent);
          if (!agent) break;
          const kind = type === 'agent.spawn' ? 'fork.start' : 'fork.end';
          out.push(mk(kind, undefined, { entity: `subagent:${session}-${agent}`, parent: entity }));
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
        default:
          break; // prompt.submit, turn.step, … are not needed
      }
    }
    return out;
  },
};

export default definePlugin({ name: 'nod', adapters: [nodAdapter] });
