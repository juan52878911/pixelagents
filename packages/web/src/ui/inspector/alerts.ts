import type { Entity } from '@pixelagents/protocol';

/** Tracks last-seen status per entity and reports which ones just *became* waiting. */
export class WaitingTracker {
  private last = new Map<string, string>();
  /** Entities currently waiting (insertion order = oldest first) with the time they started. */
  readonly waiting = new Map<string, number>();

  /** Seed from a snapshot without raising alerts. */
  reset(entities: Iterable<Entity>, now = Date.now()): void {
    this.last.clear(); this.waiting.clear();
    for (const e of entities) {
      this.last.set(e.id, e.status);
      if (e.status === 'waiting') this.waiting.set(e.id, now);
    }
  }

  /** Returns the entities that transitioned into `waiting` in this batch. */
  update(upsert: Entity[], remove: string[], now = Date.now()): Entity[] {
    const fresh: Entity[] = [];
    for (const id of remove) { this.last.delete(id); this.waiting.delete(id); }
    for (const e of upsert) {
      const prev = this.last.get(e.id);
      this.last.set(e.id, e.status);
      if (e.status === 'waiting') {
        if (prev !== 'waiting') { this.waiting.set(e.id, now); fresh.push(e); }
      } else this.waiting.delete(e.id);
    }
    return fresh;
  }
}
