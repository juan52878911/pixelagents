import type { Entity, System, World } from './ecs.js';

/** An actor is an ECS entity. */
export type Actor = Entity;

export interface BehaviorContext { world: World; /** Logical world size. */ width: number; height: number; /** Seconds since the previous frame. */ dt: number; }

export interface BehaviorDef {
  enter?(actor: Actor, ctx: BehaviorContext): void;
  update(actor: Actor, dt: number, ctx: BehaviorContext): void;
  exit?(actor: Actor, ctx: BehaviorContext): void;
}

const registry = new Map<string, BehaviorDef>();

export function registerBehavior(name: string, def: BehaviorDef): void { registry.set(name, def); }
export function getBehavior(name: string): BehaviorDef | undefined { return registry.get(name); }
export function behaviorNames(): string[] { return [...registry.keys()]; }

/** Switches the behavior of an actor, running `exit` of the old one and `enter` of the new one. */
export function setBehavior(actor: Actor, name: string, ctx: BehaviorContext): boolean {
  const def = registry.get(name);
  if (!def) return false;
  const cur = actor.behavior;
  if (cur && cur.name === name) return true;
  if (cur && cur.entered) (cur.def as BehaviorDef).exit?.(actor, ctx);
  actor.behavior = { name, def, data: cur ? cur.data : {}, entered: false };
  return true;
}

export function behaviorSystem(width: number, height: number): System {
  const ctx: BehaviorContext = { world: null as unknown as World, width, height, dt: 0 };
  return {
    name: 'behavior',
    update(dt, world) {
      ctx.world = world; ctx.dt = dt; ctx.width = width; ctx.height = height;
      const list = world.entities;
      for (let i = 0; i < list.length; i++) {
        const e = list[i]!;
        const b = e.behavior;
        if (!b) continue;
        const def = b.def as BehaviorDef;
        if (!b.entered) { b.entered = true; def.enter?.(e, ctx); }
        def.update(e, dt, ctx);
      }
    },
  };
}

/** Deterministic cheap PRNG for behaviors (no allocation). */
export function rnd(seed: number): number {
  let n = (seed ^ 61) ^ (seed >>> 16);
  n = n + (n << 3); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

// ---- built-ins (examples that exercise the path; the world builds richer ones) ----

registerBehavior('idle', {
  enter(a) { if (a.animator) { a.animator.tag = 'idle'; a.animator.playing = false; a.animator.time = 0; } },
  update() {},
});

/** Walks between random points inside the world at ~20 px/s. */
registerBehavior('wander', {
  enter(a) {
    if (a.animator) { a.animator.tag = 'walk'; a.animator.playing = true; }
    a.behavior!.data.tx = a.transform.x;
    a.behavior!.data.ty = a.transform.y;
    a.behavior!.data.n = a.id * 7919;
  },
  update(a, dt, ctx) {
    const d = a.behavior!.data;
    const dx = (d.tx as number) - a.transform.x, dy = (d.ty as number) - a.transform.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      const n = ((d.n as number) + 1) | 0;
      d.n = n;
      d.tx = 12 + rnd(n * 2) * (ctx.width - 24);
      d.ty = 24 + rnd(n * 2 + 1) * (ctx.height - 36);
      return;
    }
    const step = Math.min(dist, 20 * dt);
    a.transform.x += (dx / dist) * step;
    a.transform.y += (dy / dist) * step;
    a.transform.flip = dx < 0;
  },
});
