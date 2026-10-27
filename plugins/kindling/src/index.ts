import { definePlugin, type Adapter, type AdapterContext, type PaEvent } from '@pixelagents/protocol';

const STATE: Record<string, string> = { running: 'running', warm: 'frozen', stopped: 'ended', failed: 'failed', created: 'starting' };
const EVENT_STATE: Record<string, string> = {
  'machine.created': 'starting',
  'machine.started': 'running',
  'machine.frozen': 'frozen',
  'machine.thawed': 'running',
  'machine.stopped': 'ended',
  'machine.failed': 'failed',
};

type Rec = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

function parentOf(name: string | undefined, ctx: AdapterContext): string | undefined {
  const pat = ctx.options.agentFromName;
  if (!name || typeof pat !== 'string' || !pat) return undefined;
  try {
    const m = new RegExp(pat).exec(name);
    const g = m?.[1];
    return g ? `agent:${g}` : undefined;
  } catch {
    return undefined;
  }
}

/** ids seen in the previous `kling ps` listing, per input, to detect machines that disappear. */
const seen = new Map<string, Set<string>>();

/** Array from `kling ps -a -json`: a `state` and a `metric` event per machine; vanished machines → ended. */
export const kindlingPsAdapter: Adapter = {
  name: 'kindling-ps',
  parse(raw, ctx) {
    if (!Array.isArray(raw)) return [];
    const ts = ctx.now().toISOString();
    const out: PaEvent[] = [];
    const now = new Set<string>();
    for (const m of raw as Rec[]) {
      const id = str(m?.id);
      if (!id) continue;
      now.add(id);
      const name = str(m.name);
      const status = STATE[String(m.state)] ?? 'idle';
      const labels: Record<string, string> = {};
      if (name) labels.name = name;
      const image = str(m.image);
      if (image) labels.image = image;
      if (m.labels && typeof m.labels === 'object') {
        for (const [k, v] of Object.entries(m.labels as Rec)) if (typeof v === 'string') labels[k] = v;
      }
      const entity = `vm:${id}`;
      const parent = parentOf(name, ctx);
      const base = { ts, source: ctx.input, entity, labels, ...(parent ? { parent } : {}) };
      out.push({ ...base, kind: 'state', attrs: { status } });
      const metrics: Rec = {};
      if (typeof m.cpu_pct === 'number') metrics.cpu_pct = m.cpu_pct;
      if (typeof m.mem_mib === 'number') metrics.mem_mib = m.mem_mib;
      if (Object.keys(metrics).length) out.push({ ...base, kind: 'metric', attrs: metrics });
    }
    const prev = seen.get(ctx.input);
    if (prev) {
      for (const id of prev) {
        if (!now.has(id)) out.push({ ts, source: ctx.input, entity: `vm:${id}`, kind: 'state', attrs: { status: 'ended', reason: 'gone' } });
      }
    }
    seen.set(ctx.input, now);
    return out;
  },
};

/** Lines of `kling events -json`. */
export const kindlingEventsAdapter: Adapter = {
  name: 'kindling-events',
  parse(raw, ctx) {
    if (raw == null || typeof raw !== 'object') return [];
    const e = raw as Rec;
    const id = str(e.id);
    const ts = str(e.time);
    const status = EVENT_STATE[String(e.type)];
    if (!id || !ts || !status) return [];
    const name = str(e.name);
    const parent = parentOf(name, ctx);
    const attrs: Rec = { status };
    const message = str(e.message);
    if (message && status === 'failed') attrs.reason = message.slice(0, 120);
    return [
      {
        ts,
        source: ctx.input,
        entity: `vm:${id}`,
        kind: 'state',
        labels: (name ? { name } : {}) as Record<string, string>,
        attrs,
        ...(parent ? { parent } : {}),
      },
    ];
  },
};

export default definePlugin({
  name: 'kindling',
  adapters: [kindlingPsAdapter, kindlingEventsAdapter],
  defaults: {
    classify: [{ name: 'kindling vms in the lab', match: { kind: 'vm' }, set: { 'view.group': 'kindling', 'view.behavior': 'vm' } }],
    groups: { by: '{{labels.host}}', kinds: { kindling: 'lab' } },
    behaviors: {
      vm: { running: 'type', frozen: 'frozen', failed: 'fire', ended: 'dead', starting: 'teleport' },
    },
  },
});
