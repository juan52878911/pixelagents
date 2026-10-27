import {
  PROTOCOL_VERSION,
  applyRules,
  compilePattern,
  renderTemplate,
  type Delta,
  type Entity,
  type Group,
  type PaConfig,
  type PaEvent,
  type Reducer,
  type StateSnapshot,
} from '@pixelagents/protocol';
import { coreReduce, newEntity } from './reducer.js';

export interface StoreDeps {
  config(): PaConfig;
  reducers(): Reducer[];
  now(): Date;
  /** Called when something changed and a delta should be flushed soon. */
  onDirty(): void;
  warn(msg: string): void;
}

/** Entity state: reducers, timers, classification and delta computation. */
export class Store {
  /** Entities as reduced (before classification). */
  readonly raw = new Map<string, Entity>();
  /** Entities as served (classified: labels/view filled by rules). */
  private pub = new Map<string, Entity>();
  private groups = new Map<string, Group>();
  /** Entity id → hub input id, for entities replicated from another server. */
  private hubOwner = new Map<string, string>();
  seq = 0;
  private dirty = new Set<string>();
  private removed = new Set<string>();
  private events: PaEvent[] = [];
  private reclassify = false;

  constructor(private deps: StoreDeps) {}

  ingest(ev: PaEvent): void {
    const cfg = this.deps.config();
    const ctx = { config: cfg, now: () => this.deps.now(), get: (id: string) => this.raw.get(id) };
    let e: Entity | null = coreReduce(this.raw.get(ev.entity) ?? newEntity(ev), ev, cfg.timing.historyMax);
    for (const r of this.deps.reducers()) {
      if (!e) break;
      if (r.kinds && !r.kinds.some((k) => ev.kind === k || ev.kind.startsWith(k))) continue;
      try {
        e = r.reduce(e, ev, ctx);
      } catch (err) {
        this.deps.warn(`reducer ${r.name} failed on ${ev.kind}: ${(err as Error).message}`);
      }
    }
    this.hubOwner.delete(ev.entity);
    if (e) {
      this.raw.set(ev.entity, e);
      this.dirty.add(ev.entity);
      this.removed.delete(ev.entity);
    } else {
      this.drop(ev.entity);
    }
    this.events.push(ev);
    this.deps.onDirty();
  }

  private drop(id: string): void {
    if (this.raw.delete(id)) this.removed.add(id);
    this.dirty.delete(id);
    this.hubOwner.delete(id);
  }

  /** Timers: sleep, ended linger, forget. */
  tick(): void {
    const t = this.deps.config().timing;
    const now = this.deps.now().getTime();
    let changed = false;
    for (const [id, e] of this.raw) {
      if (this.hubOwner.has(id)) continue;
      const age = now - Date.parse(e.lastSeen);
      if (Number.isNaN(age)) continue;
      if (e.status === 'ended' && age > t.endedLingerSec * 1000) {
        this.drop(id);
        changed = true;
      } else if (age > t.forgetAfterSec * 1000) {
        this.drop(id);
        changed = true;
      } else if (e.status === 'idle' && age > t.sleepAfterSec * 1000) {
        e.status = 'sleeping';
        this.dirty.add(id);
        changed = true;
      }
    }
    if (changed) this.deps.onDirty();
  }

  /** Replicate entities coming from another server (hub input). */
  hubApply(hub: string, upsert: Entity[] = [], remove: string[] = [], events: PaEvent[] = []): void {
    for (const u of upsert) {
      const owner = this.hubOwner.get(u.id);
      if (this.raw.has(u.id) && !owner) continue; // a local entity wins
      const e = structuredClone(u);
      e.labels = { ...e.labels, hub };
      this.raw.set(e.id, e);
      this.hubOwner.set(e.id, hub);
      this.dirty.add(e.id);
      this.removed.delete(e.id);
    }
    for (const id of remove) if (this.hubOwner.get(id) === hub) this.drop(id);
    this.events.push(...events);
    this.deps.onDirty();
  }

  hubDrop(hub: string): void {
    for (const [id, h] of [...this.hubOwner]) if (h === hub) this.drop(id);
    this.deps.onDirty();
  }

  reclassifyAll(): void {
    this.reclassify = true;
    this.deps.onDirty();
  }

  private classify(e: Entity, cfg: PaConfig): Entity {
    // Cheaper than applyRules' structuredClone of the whole entity (history can be long): copy only what
    // rules may write to. Rules are applied by applyRules itself on this small shell.
    const shell = {
      ...e,
      labels: { ...e.labels },
      view: { ...e.view },
      metrics: { ...e.metrics },
      activity: e.activity && { ...e.activity },
      history: [] as Entity['history'],
    };
    const c = (cfg.classify.length ? applyRules(shell, cfg.classify) : shell) as Entity;
    c.history = e.history.slice();
    c.view.group = c.view.group || renderTemplate(cfg.groups.by, c) || 'default';
    return c;
  }

  private buildGroups(cfg: PaConfig): Map<string, Group> {
    const by = new Map<string, Entity[]>();
    for (const e of this.pub.values()) {
      // Hidden entities (host/account metrics) feed gauges but neither make nor count in a group.
      if (e.view.hidden) continue;
      const g = e.view.group as string;
      let arr = by.get(g);
      if (!arr) by.set(g, (arr = []));
      arr.push(e);
    }
    const kinds = Object.entries(cfg.groups.kinds ?? {}).map(([glob, kind]) => [compilePattern(glob), kind] as const);
    const out = new Map<string, Group>();
    for (const [id, ents] of by) {
      const first = ents[0]!;
      let labels = { ...first.labels };
      for (const e of ents) for (const k of Object.keys(labels)) if (labels[k] !== e.labels[k]) delete labels[k];
      const metrics: Record<string, number> = { agents: 0, working: 0, waiting: 0, cost_usd: 0 };
      for (const e of ents) {
        if (e.status !== 'ended') metrics.agents!++;
        if (e.status === 'working') metrics.working!++;
        if (e.status === 'waiting') metrics.waiting!++;
        metrics.cost_usd! += e.metrics.cost_usd ?? 0;
      }
      metrics.cost_usd = Math.round(metrics.cost_usd! * 1e6) / 1e6;
      const kind = kinds.find(([re]) => re.test(id))?.[1] ?? 'office';
      const label = (cfg.groups.label ? renderTemplate(cfg.groups.label, first) : '') || id;
      out.set(id, { id, kind, label, labels, metrics });
    }
    return out;
  }

  /** Classify what changed and return the delta to broadcast (null when nothing changed). */
  commit(): Delta | null {
    const cfg = this.deps.config();
    const upsert: Entity[] = [];
    const remove: string[] = [];
    if (this.reclassify) {
      this.reclassify = false;
      for (const id of this.raw.keys()) this.dirty.add(id);
    }
    const structural = this.dirty.size > 0 || this.removed.size > 0;
    for (const id of this.dirty) {
      const e = this.raw.get(id);
      if (!e) continue;
      const c = this.classify(e, cfg);
      this.pub.set(id, c);
      upsert.push(c);
    }
    for (const id of this.removed) {
      if (this.pub.delete(id)) remove.push(id);
    }
    this.dirty.clear();
    this.removed.clear();
    const events = this.events;
    this.events = [];

    let groups: Group[] | undefined;
    let removeGroups: string[] | undefined;
    if (structural) {
      const next = this.buildGroups(cfg);
      const changed: Group[] = [];
      for (const [id, g] of next) {
        const prev = this.groups.get(id);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(g)) changed.push(g);
      }
      const gone = [...this.groups.keys()].filter((id) => !next.has(id));
      this.groups = next;
      if (changed.length) groups = changed;
      if (gone.length) removeGroups = gone;
    }
    if (!upsert.length && !remove.length && !groups && !removeGroups && !events.length) return null;
    const delta: Delta = { seq: ++this.seq };
    if (upsert.length) delta.upsert = upsert;
    if (remove.length) delta.remove = remove;
    if (groups) delta.groups = groups;
    if (removeGroups) delta.removeGroups = removeGroups;
    if (events.length) delta.events = events;
    return delta;
  }

  /** Current state; call commit() first so it includes the latest changes. */
  snapshot(): StateSnapshot {
    return { protocol: PROTOCOL_VERSION, seq: this.seq, entities: [...this.pub.values()], groups: [...this.groups.values()] };
  }

  /** Local (non-hub) entities for persistence. */
  dump(): { protocol: number; seq: number; savedAt: string; entities: Entity[] } {
    const entities: Entity[] = [];
    for (const [id, e] of this.raw) if (!this.hubOwner.has(id)) entities.push(e);
    return { protocol: PROTOCOL_VERSION, seq: this.seq, savedAt: this.deps.now().toISOString(), entities };
  }

  load(data: { seq?: number; entities?: Entity[] }): void {
    if (typeof data.seq === 'number') this.seq = data.seq;
    for (const e of data.entities ?? []) {
      if (!e || typeof e.id !== 'string') continue;
      this.raw.set(e.id, e);
      this.dirty.add(e.id);
    }
    if (this.dirty.size) this.deps.onDirty();
  }

  get size(): number {
    return this.raw.size;
  }
}
