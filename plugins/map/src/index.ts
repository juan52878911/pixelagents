import { definePlugin, getPath, matches, renderTemplate, type Adapter, type PaEvent } from '@pixelagents/protocol';

type Rec = Record<string, unknown>;

/** A template that is exactly one `{{path}}` returns the typed value; anything else renders to a string. */
function renderValue(v: unknown, rec: unknown): unknown {
  if (typeof v !== 'string') return v;
  const whole = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/.exec(v);
  if (whole) {
    const got = getPath(rec, whole[1]!);
    return got == null ? '' : got;
  }
  return renderTemplate(v, rec);
}

function toIso(v: unknown, fallback: Date): string {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

/**
 * Generic, code-free adapter. Options:
 * `{ entity, kind: "tpl" | {fromField, map}, labels?, attrs?, ts?, when? }` applied to each JSON record.
 * Records that do not satisfy `when`, or whose entity/kind come out empty, are ignored.
 */
export const mapAdapter: Adapter = {
  name: 'map',
  parse(raw, ctx) {
    let rec: unknown = raw;
    if (typeof raw === 'string') {
      try {
        rec = JSON.parse(raw);
      } catch {
        return [];
      }
    }
    if (rec == null || typeof rec !== 'object') return [];
    const o = ctx.options;
    if (o.when && typeof o.when === 'object' && !matches(rec, o.when as Record<string, string | string[]>)) return [];
    if (typeof o.entity !== 'string') return [];
    const entity = renderTemplate(o.entity, rec).trim();
    if (!entity) return [];

    let kind = '';
    if (typeof o.kind === 'string') kind = renderTemplate(o.kind, rec).trim();
    else if (o.kind && typeof o.kind === 'object') {
      const k = o.kind as { fromField?: string; map?: Record<string, string> };
      const val = k.fromField ? getPath(rec, k.fromField) : undefined;
      const key = val == null ? '' : String(val);
      kind = (k.map && (k.map[key] ?? k.map['*'])) || '';
    }
    if (!kind) return [];

    const ev: PaEvent = {
      ts: toIso(typeof o.ts === 'string' ? renderValue(o.ts, rec) : undefined, ctx.now()),
      source: ctx.input,
      entity,
      kind,
    };
    if (o.labels && typeof o.labels === 'object') {
      const labels: Record<string, string> = {};
      for (const [k, v] of Object.entries(o.labels as Rec)) {
        const s = renderTemplate(String(v), rec);
        if (s !== '') labels[k] = s;
      }
      if (Object.keys(labels).length) ev.labels = labels;
    }
    if (o.attrs && typeof o.attrs === 'object') {
      const attrs: Rec = {};
      for (const [k, v] of Object.entries(o.attrs as Rec)) {
        const r = renderValue(v, rec);
        if (r !== '') attrs[k] = r;
      }
      if (Object.keys(attrs).length) ev.attrs = attrs;
    }
    return [ev];
  },
};

export default definePlugin({ name: 'map', adapters: [mapAdapter] });
