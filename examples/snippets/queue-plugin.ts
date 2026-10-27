import { definePlugin, type Adapter, type PaEvent, type Reducer } from '@pixelagents/protocol';

/** Input: the plain text output of a command, e.g. `queue=emails depth=120 workers=3` per line. */
export const queueAdapter: Adapter = {
  name: 'queue',
  parse(raw, ctx) {
    const text = typeof raw === 'string' ? raw : '';
    const out: PaEvent[] = [];
    for (const line of text.split('\n')) {
      const kv = Object.fromEntries([...line.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1]!, m[2]!]));
      if (!kv.queue) continue;
      const depth = Number(kv.depth);
      if (!Number.isFinite(depth)) continue;
      out.push({
        ts: ctx.now().toISOString(),
        source: ctx.input,
        entity: `queue:${kv.queue}`,
        kind: 'queue.sample',
        attrs: { depth, workers: Number(kv.workers) || 0 },
      });
    }
    return out;
  },
};

/** Folds samples into the entity. `kinds` filters by prefix: only `queue.*` events reach it. */
export const queueReducer: Reducer = {
  name: 'queue',
  kinds: ['queue.'],
  reduce(entity, ev) {
    const depth = Number(ev.attrs?.depth ?? 0);
    entity.metrics.depth = depth;
    entity.metrics.workers = Number(ev.attrs?.workers ?? 0);
    entity.status = depth > 0 ? 'working' : 'idle';
    return entity; // returning null would delete the entity
  },
};

export default definePlugin({ name: 'queue', adapters: [queueAdapter], reducers: [queueReducer] });
