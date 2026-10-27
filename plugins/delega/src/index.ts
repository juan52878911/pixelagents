import { definePlugin, type Adapter, type AdapterContext, type PaEvent } from '@pixelagents/protocol';

/** "6.49", "1.234,5", "6,49" → number. */
function toNum(s: string | undefined): number | undefined {
  if (s === undefined) return undefined;
  let t = s.trim();
  if (t.includes(',') && t.includes('.')) t = t.replace(/\./g, '').replace(',', '.');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
const N = '(\\d[\\d.,]*)';

function metric(ctx: AdapterContext, profile: string, attrs: Record<string, number>): PaEvent {
  return {
    ts: ctx.now().toISOString(),
    source: ctx.input,
    entity: `account:${profile}`,
    kind: 'metric',
    labels: { account: profile },
    attrs,
  };
}

/** Text of `delega quota --no-probe`. Tolerant: lines that do not match are ignored. */
export const delegaQuotaAdapter: Adapter = {
  name: 'delega-quota',
  parse(raw, ctx) {
    if (typeof raw !== 'string') return [];
    const order: string[] = [];
    const by = new Map<string, Record<string, number>>();
    const get = (p: string) => {
      let a = by.get(p);
      if (!a) {
        a = {};
        by.set(p, a);
        order.push(p);
      }
      return a;
    };
    let cur: string | undefined;
    for (const line of raw.split('\n')) {
      const head = /^\s*\[([^\]]+)\]/.exec(line);
      if (head) {
        cur = head[1]!.trim();
        const a = get(cur);
        const five = toNum(new RegExp(`5\\s*h:\\s*${N}\\s*%`).exec(line)?.[1]);
        const week = toNum(new RegExp(`semanal:\\s*${N}\\s*%`).exec(line)?.[1]);
        if (five !== undefined) a.five_hour_pct = five;
        if (week !== undefined) a.weekly_pct = week;
        continue;
      }
      if (!cur) continue;
      const slots = toNum(new RegExp(`puedes lanzar\\s+${N}\\s+m[aá]s`, 'i').exec(line)?.[1]);
      if (slots !== undefined) get(cur).slots_free = slots;
      const sp = new RegExp(`gasto de hoy:\\s*${N}\\s*\\$(?:\\s*de\\s*${N}\\s*\\$)?`, 'i').exec(line);
      if (sp) {
        const a = get(cur);
        const spend = toNum(sp[1]);
        const budget = toNum(sp[2]);
        if (spend !== undefined) a.spend_usd = spend;
        if (budget !== undefined) a.budget_usd = budget;
      }
    }
    const out: PaEvent[] = [];
    let slots = 0;
    let anySlots = false;
    for (const p of order) {
      const a = by.get(p)!;
      if (!Object.keys(a).length) continue;
      out.push(metric(ctx, p, a));
      if (a.slots_free !== undefined) {
        slots += a.slots_free;
        anySlots = true;
      }
    }
    if (anySlots) out.push(metric(ctx, 'total', { slots_free: slots }));
    return out;
  },
};

/** Text of `delega spend day --by profile`. */
export const delegaSpendAdapter: Adapter = {
  name: 'delega-spend',
  parse(raw, ctx) {
    if (typeof raw !== 'string') return [];
    const out: PaEvent[] = [];
    for (const line of raw.split('\n')) {
      const total = toNum(new RegExp(`^\\s*TOTAL\\b.*?${N}\\s*\\$`, 'i').exec(line)?.[1]);
      if (total !== undefined) {
        out.push(metric(ctx, 'total', { spend_usd: total }));
        continue;
      }
      const b = new RegExp(`presupuesto de hoy\\s*[·.:-]+\\s*([^:\\s]+):\\s*${N}\\s*\\$\\s*de\\s*${N}\\s*\\$`, 'i').exec(line);
      const spend = toNum(b?.[2]);
      const budget = toNum(b?.[3]);
      if (b && spend !== undefined && budget !== undefined) out.push(metric(ctx, b[1]!, { spend_usd: spend, budget_usd: budget }));
    }
    return out;
  },
};

export default definePlugin({ name: 'delega', adapters: [delegaQuotaAdapter, delegaSpendAdapter] });
