import { fileURLToPath } from 'node:url';
import { definePlugin, type Adapter, type PaEvent, type Reducer } from '@pixelagents/protocol';

/**
 * Source: `bin/sample.mjs` prints `[{ name, host, state, progress }]`. The adapter turns each job into
 * a `hello.job` event for the entity `job:<name>`. It reads only those four fields (privacy rule:
 * adapters pick fields, they never copy a record wholesale).
 */
export const helloAdapter: Adapter = {
  name: 'hello',
  parse(raw, ctx) {
    const list = Array.isArray(raw) ? raw : [raw];
    const out: PaEvent[] = [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const j = r as Record<string, unknown>;
      if (typeof j.name !== 'string' || typeof j.state !== 'string') continue;
      const progress = Number(j.progress);
      out.push({
        ts: ctx.now().toISOString(),
        source: ctx.input,
        entity: `job:${j.name}`,
        kind: 'hello.job',
        labels: typeof j.host === 'string' ? { host: j.host } : undefined,
        attrs: { state: j.state, ...(Number.isFinite(progress) ? { progress } : {}) },
      });
    }
    return out;
  },
};

const STATUS: Record<string, string> = { queued: 'idle', running: 'working', done: 'sleeping' };

/** Folds `hello.job` into the entity: job state -> status, progress -> metrics.progress. */
export const helloReducer: Reducer = {
  name: 'hello',
  kinds: ['hello.'],
  reduce(entity, ev) {
    const state = String(ev.attrs?.state ?? '');
    entity.status = STATUS[state] ?? 'idle';
    if (typeof ev.attrs?.progress === 'number') entity.metrics.progress = ev.attrs.progress;
    entity.activity = { tool: 'job', detail: `${entity.id.slice(4)} ${state}`, category: 'run', since: ev.ts };
    return entity;
  },
};

export default definePlugin({
  name: 'hello',
  adapters: [helloAdapter],
  reducers: [helloReducer],
  // Merged UNDER the user's config; `classify` and `effects` lists are concatenated.
  defaults: {
    classify: [{ name: 'hello jobs are minions', match: { kind: 'job' }, set: { 'view.behavior': 'minion', 'view.skin': 'default' } }],
  },
  clientEntry: fileURLToPath(new URL('../dist/client.js', import.meta.url)),
});
