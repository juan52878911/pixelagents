import type { Delta, Entity, Group, PaConfig, PaEvent, StateSnapshot } from '@pixelagents/protocol';

/**
 * Client of `GET /events` (SSE). Named events the server sends:
 *   snapshot  → StateSnapshot (first message of every connection)
 *   delta     → Delta (≤10 Hz, `seq` increases by 1)
 *   config    → PaConfig (on connect and after every config change)
 *   assets    → anything (sprite files changed → reload)
 * Deltas are applied in `seq` order: stale ones are dropped, early ones wait for the gap to close.
 */
export type StoreChange =
  | { type: 'snapshot' }
  | { type: 'delta'; upsert: Entity[]; remove: string[]; events: PaEvent[] }
  | { type: 'config'; config: PaConfig }
  | { type: 'assets' }
  | { type: 'status'; status: StoreStatus };

export type StoreStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type Listener = (change: StoreChange, store: Store) => void;

export interface EventSourceLike {
  addEventListener(type: string, cb: (ev: { data: string }) => void): void;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
}
export type EventSourceFactory = (url: string) => EventSourceLike;

/** Deltas that arrive this far ahead of the expected seq trigger a resync. */
const MAX_PENDING = 100;

export class Store {
  entities = new Map<string, Entity>();
  groups = new Map<string, Group>();
  seq = -1;
  config: PaConfig | null = null;
  status: StoreStatus = 'idle';
  private listeners = new Set<Listener>();
  private pending = new Map<number, Delta>();
  private source: EventSourceLike | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private url = '/events';
  private factory: EventSourceFactory = (u) => new EventSource(u) as unknown as EventSourceLike;

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(c: StoreChange): void { for (const l of this.listeners) l(c, this); }

  applySnapshot(s: StateSnapshot): void {
    this.entities.clear(); this.groups.clear();
    for (const e of s.entities) this.entities.set(e.id, e);
    for (const g of s.groups) this.groups.set(g.id, g);
    this.seq = s.seq;
    this.emit({ type: 'snapshot' });
    this.drain();
  }

  /** Returns false if the delta was dropped as stale. Early deltas are held until the gap closes. */
  applyDelta(d: Delta): boolean {
    if (this.seq < 0) { this.pending.set(d.seq, d); return true; } // before the snapshot
    if (d.seq <= this.seq) return false;
    if (d.seq !== this.seq + 1) {
      this.pending.set(d.seq, d);
      if (this.pending.size > MAX_PENDING) this.resync();
      return true;
    }
    this.apply(d);
    this.drain();
    return true;
  }

  private drain(): void {
    for (let d = this.pending.get(this.seq + 1); d; d = this.pending.get(this.seq + 1)) {
      this.pending.delete(d.seq);
      this.apply(d);
    }
    for (const k of this.pending.keys()) if (k <= this.seq) this.pending.delete(k);
  }

  private apply(d: Delta): void {
    const upsert = d.upsert ?? [], remove = d.remove ?? [];
    for (const e of upsert) this.entities.set(e.id, e);
    for (const id of remove) this.entities.delete(id);
    for (const g of d.groups ?? []) this.groups.set(g.id, g);
    for (const id of d.removeGroups ?? []) this.groups.delete(id);
    this.seq = d.seq;
    this.emit({ type: 'delta', upsert, remove, events: d.events ?? [] });
  }

  setConfig(c: PaConfig): void { this.config = c; this.emit({ type: 'config', config: c }); }

  private setStatus(s: StoreStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit({ type: 'status', status: s });
  }

  // ---- connection ----

  connect(url = '/events', factory?: EventSourceFactory): void {
    this.url = url;
    if (factory) this.factory = factory;
    this.open();
  }

  private open(): void {
    this.source?.close();
    this.pending.clear(); // deltas of a dropped connection are meaningless for the next snapshot
    this.setStatus(this.retry ? 'reconnecting' : 'connecting');
    const es = this.factory(this.url);
    this.source = es;
    const on = (type: string, fn: (data: unknown) => void) =>
      es.addEventListener(type, (ev) => { try { fn(JSON.parse(ev.data)); } catch (err) { console.warn(`store: bad "${type}" event`, err); } });
    es.addEventListener('open', () => { this.retry = 0; this.setStatus('open'); });
    on('snapshot', (d) => { this.retry = 0; this.setStatus('open'); this.applySnapshot(d as StateSnapshot); });
    on('delta', (d) => this.applyDelta(d as Delta));
    on('config', (d) => this.setConfig(d as PaConfig));
    on('assets', () => this.emit({ type: 'assets' }));
    es.onerror = () => {
      es.close();
      if (this.source !== es) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.retry++, 5));
    this.timer = setTimeout(() => this.open(), delay);
  }

  /** Drops state and reconnects to get a fresh snapshot. */
  resync(): void {
    this.seq = -1; this.pending.clear();
    this.open();
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.source?.close(); this.source = null;
    this.setStatus('closed');
  }
}

// ---- demo mode (`?demo`): no server needed ----

const STATUSES = ['working', 'thinking', 'waiting', 'idle', 'sleeping'] as const;
const TOOLS = ['Edit', 'Read', 'Bash', 'Grep', 'WebFetch'];

function demoEntity(i: number, now: number): Entity {
  const iso = new Date(now).toISOString();
  return {
    id: `agent:demo-${i}`, kind: 'agent', labels: { host: `host-${i % 4}`, repo: `repo-${i % 7}` },
    status: 'idle', metrics: { cost_usd: 0 }, firstSeen: iso, lastSeen: iso, history: [],
    view: { group: `host-${i % 4}`, skin: `skin-${i % 4}` },
  };
}

/** Feeds the store with synthetic agents: a snapshot, then deltas at 10 Hz. Returns a stop function. */
export function startDemo(store: Store, count = 12): () => void {
  const now = Date.now();
  const ents = Array.from({ length: count }, (_, i) => demoEntity(i, now));
  const groups: Group[] = [0, 1, 2, 3].map((i) => ({ id: `host-${i}`, kind: 'office', label: `HOST-${i}`, labels: { host: `host-${i}` }, metrics: {} }));
  store.applySnapshot({ protocol: 1, seq: 0, entities: ents, groups });
  let seq = 0, n = 0;
  const timer = setInterval(() => {
    const t = Date.now();
    const upsert: Entity[] = [];
    for (let k = 0; k < 2; k++) {
      const e = ents[(n * 7 + k * 3) % ents.length]!;
      e.status = STATUSES[(n + k) % STATUSES.length]!;
      e.lastSeen = new Date(t).toISOString();
      e.activity = { tool: TOOLS[(n + k) % TOOLS.length], category: 'edit', since: e.lastSeen };
      upsert.push({ ...e });
    }
    n++;
    store.applyDelta({ seq: ++seq, upsert });
  }, 100);
  return () => clearInterval(timer);
}
