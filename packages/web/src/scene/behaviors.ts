/**
 * Scene behaviors registered in the engine (status → name via config.behaviors). They only move
 * the actor and write render state into `actor.data.a`; the scene paints from that state.
 * Timings follow the prototype (visitorSegs, convoState, POD_CYCLE, POOF).
 */
import { type Actor, type BehaviorContext, type BehaviorDef, registerBehavior, setBehavior } from '../engine/behaviors.js';
import type { Store } from '../store.js';
import type { ActorData, SeatState } from './actor.js';
import { HANDOFF_SEC, social } from './social.js';

const WALK = 22; // px/s
const LEGS = [1, 0, 2, 0];

export function dataOf(a: Actor): ActorData { return a.data.a as ActorData; }

/** Shared scene clock (seconds) so behaviors and drawing agree on walk frames. */
export const clock = { t: 0 };
const legs = () => LEGS[Math.floor(clock.t * 8) % 4]!;

function reset(d: ActorData): void {
  d.bt = 0; d.walker = null; d.say = null; d.wave = false; d.door = false; d.ding = 0; d.greet = -1; d.talk = null; d.handoff = null;
}

/**
 * Hand-off (social.ts): when a subagent starts or finishes, the parent stands in front of its desk,
 * where its minis sit, for HANDOFF_SEC. Reuses the `talk` render path (standing below the desk,
 * monitor off) with `lt` fixed so the scene draws no talk bubble: the ping bubble shows the icon.
 */
function handoff(a: Actor, d: ActorData, dt: number): boolean {
  if (!d.handoff) {
    const k = d.slot ? social.consume(d.id) : null;
    if (!k) return false;
    d.handoff = { kind: k, t: 0 };
  }
  d.handoff.t += dt;
  if (d.handoff.t >= HANDOFF_SEC || !d.slot) { d.handoff = null; d.talk = null; return false; }
  d.seat = null;
  d.talk = { with: '', phase: 'talk', x: d.slot.dx + 3, dir: 1, lt: 0.9 };
  return true;
}

/** Leaves the current one-shot behavior for what the status wants now. */
function finish(a: Actor, ctx: BehaviorContext): void {
  const d = dataOf(a);
  const next = d.want && d.want !== a.behavior?.name ? d.want : 'idle';
  if (!setBehavior(a, next, ctx)) setBehavior(a, 'idle', ctx);
}

function seated(state: SeatState): BehaviorDef {
  return {
    enter(a) { const d = dataOf(a); reset(d); d.seat = state; d.desk = 1; d.gone = false; d.showItem = true; },
    update(a, dt) {
      const d = dataOf(a);
      d.bt += dt;
      if (d.desk < 1) d.desk = Math.min(1, d.desk + dt);
      if (handoff(a, d, dt)) return;
      d.seat = state;
    },
    exit(a) { const d = dataOf(a); if (d.handoff) { d.handoff = null; d.talk = null; } },
  };
}

interface Geo { seatX: number; seatY: number; doorX: number; doorY: number; laneY: number }
function geo(d: ActorData): Geo | null {
  if (!d.slot || !d.office) return null;
  const o = d.office;
  return { seatX: d.slot.dx + 2, seatY: d.slot.dy - 10, doorX: o.x + o.door, doorY: o.y + 1, laneY: o.y + 4 };
}

type Seg = [string, number];
function phase(segs: Seg[], t: number): { name: string; p: number; tin: number; rem: number; done: boolean } {
  let acc = 0;
  for (const [n, len] of segs) { if (t < acc + len) return { name: n, p: (t - acc) / len, tin: t - acc, rem: acc + len - t, done: false }; acc += len; }
  return { name: segs[segs.length - 1]![0], p: 1, tin: 0, rem: 0, done: true };
}

export function arriveSegs(g: Geo): Seg[] {
  const walk = Math.max(0.2, Math.abs(g.seatX - g.doorX) / WALK), desc = Math.max(0.2, (g.seatY - g.laneY) / WALK);
  return [['doorOpen', 0.7], ['emerge', 0.5], ['laneIn', walk], ['build', 1.5], ['descend', desc], ['greet', 2.8]];
}
export function leaveSegs(g: Geo): Seg[] {
  const walk = Math.max(0.2, Math.abs(g.seatX - g.doorX) / WALK), desc = Math.max(0.2, (g.seatY - g.laneY) / WALK);
  return [['wave', 2], ['ascend', desc], ['laneOut', walk], ['enter', 0.7]];
}

const arrive: BehaviorDef = {
  enter(a) { const d = dataOf(a); reset(d); d.seat = null; d.desk = 0; d.gone = false; d.showItem = false; },
  update(a, dt, ctx) {
    const d = dataOf(a);
    d.bt += dt;
    const g = geo(d);
    if (!g) { d.desk = 1; finish(a, ctx); return; }
    const ph = phase(arriveSegs(g), d.bt), f = legs();
    d.walker = null; d.seat = null; d.door = false; d.ding = 0; d.say = null; d.greet = -1;
    switch (ph.name) {
      case 'doorOpen': d.door = ph.p > 0.4; d.ding = ph.p; break;
      case 'emerge': d.door = true; d.walker = { x: g.doorX, y: g.doorY + (g.laneY - g.doorY) * ph.p, view: 'front', legs: f, item: true }; break;
      case 'laneIn': d.door = ph.tin < 0.5; d.walker = { x: g.doorX + (g.seatX - g.doorX) * ph.p, y: g.laneY, view: 'side', flip: g.seatX < g.doorX, legs: f, hand: f === 1 ? 1 : 0, item: true }; break;
      case 'build': d.desk = ph.p; d.walker = { x: g.seatX, y: g.laneY, view: 'front', legs: 0, item: true }; break;
      case 'descend': d.desk = 1; d.walker = { x: g.seatX, y: g.laneY + (g.seatY - g.laneY) * ph.p, view: 'front', legs: f, item: true }; break;
      case 'greet': d.desk = 1; d.seat = 'work'; d.showItem = true; d.greet = ph.tin; if (ph.tin < 1.4) d.say = 'HOLA'; break;
    }
    a.transform.x = d.walker?.x ?? g.seatX; a.transform.y = d.walker?.y ?? g.seatY;
    if (ph.done) { d.say = null; d.greet = -1; finish(a, ctx); }
  },
};

const leave: BehaviorDef = {
  enter(a) { const d = dataOf(a); reset(d); },
  update(a, dt) {
    const d = dataOf(a);
    if (d.gone) return;
    d.bt += dt;
    const g = geo(d);
    if (!g) { d.gone = true; d.seat = null; d.desk = 0; return; }
    const ph = phase(leaveSegs(g), d.bt), f = legs();
    d.walker = null; d.seat = null; d.door = false; d.say = null; d.wave = false;
    switch (ph.name) {
      case 'wave': d.seat = 'idle'; d.say = 'CHAO'; d.wave = true; d.desk = 1; break;
      case 'ascend': d.showItem = false; d.walker = { x: g.seatX, y: g.seatY + (g.laneY - g.seatY) * ph.p, view: 'back', legs: f, item: true }; break;
      case 'laneOut': d.door = ph.rem < 0.6; d.desk = Math.max(0, 1 - ph.tin / 1.2); d.walker = { x: g.seatX + (g.doorX - g.seatX) * ph.p, y: g.laneY, view: 'side', flip: g.doorX < g.seatX, legs: f, hand: f === 1 ? 1 : 0, item: true }; break;
      case 'enter': d.door = true; d.desk = 0; d.walker = { x: g.doorX, y: g.laneY + (g.doorY - g.laneY) * ph.p, view: 'back', legs: f, alpha: 1 - ph.p, item: true }; break;
    }
    a.transform.x = d.walker?.x ?? g.seatX; a.transform.y = d.walker?.y ?? g.seatY;
    if (ph.done) { d.gone = true; d.walker = null; d.desk = 0; d.door = false; }
  },
};

/** Visit another agent of the same office: walk below the desks, talk 4.5 s, walk back. */
const talk: BehaviorDef = {
  enter(a) { const d = dataOf(a); d.bt = 0; d.walker = null; d.say = null; },
  update(a, dt, ctx) {
    const d = dataOf(a);
    d.bt += dt;
    const other = d.talk ? (ctx.world.get(d.talk.with)?.data.a as ActorData | undefined) : undefined;
    if (!d.talk || !d.slot || !other?.slot || other.gone || other.slot.dy !== d.slot.dy) { if (other) other.talkedBy = null; d.talk = null; d.seat = null; finish(a, ctx); return; }
    const ax = d.slot.dx + 3, bx = other.slot.dx + 3, wt = Math.abs(bx - ax) / WALK, TALK = 4.5, dir = bx > ax ? 1 : -1;
    const lt = d.bt;
    d.seat = null; other.talkedBy = null;
    if (lt < 0.4) { d.talk.phase = 'walk'; d.talk.x = ax; d.talk.dir = dir; }
    else if (lt < 0.4 + wt) { d.talk.phase = 'walk'; d.talk.x = ax + (bx - ax) * ((lt - 0.4) / wt); d.talk.dir = dir; }
    else if (lt < 0.4 + wt + TALK) { d.talk.phase = 'talk'; d.talk.x = bx; d.talk.lt = lt - 0.4 - wt; other.talkedBy = { lt: d.talk.lt }; }
    else if (lt < 0.4 + 2 * wt + TALK) { d.talk.phase = 'walk'; d.talk.x = bx + (ax - bx) * ((lt - 0.4 - wt - TALK) / wt); d.talk.dir = -dir; }
    else { d.talk = null; finish(a, ctx); return; }
    a.transform.x = d.talk.x; a.transform.y = d.slot.dy + 8;
  },
  exit(a, ctx) {
    const d = dataOf(a);
    if (d.talk) { const o = ctx.world.get(d.talk.with)?.data.a as ActorData | undefined; if (o) o.talkedBy = null; }
    d.talk = null;
  },
};

const minion: BehaviorDef = {
  enter(a) { const d = dataOf(a); d.bt = 0; d.gone = false; d.mini = { alpha: 0, poof: 0 }; },
  update(a, dt) {
    const d = dataOf(a);
    d.bt += dt;
    const p = d.bt / 0.7;
    d.mini = p < 1 ? { alpha: p > 0.5 ? 1 : 0, poof: p } : { alpha: 1, poof: null };
  },
};

const poofB: BehaviorDef = {
  enter(a) { const d = dataOf(a); d.bt = 0; },
  update(a, dt) {
    const d = dataOf(a);
    if (d.gone) return;
    d.bt += dt;
    const p = d.bt / 0.7;
    if (p >= 1) { d.gone = true; d.mini = null; return; }
    d.mini = { alpha: p < 0.5 ? 1 : 0, poof: p };
  },
};

function pod(st: 'run' | 'frozen' | 'fire' | 'dead'): BehaviorDef {
  return {
    enter(a) { const d = dataOf(a); d.bt = 0; d.gone = false; d.pod = { st }; },
    update(a, dt) { const d = dataOf(a); d.bt += dt; d.pod = { st }; },
  };
}

/** Beam in, then materialize, then whatever the status wants (running). */
const teleport: BehaviorDef = {
  enter(a) { const d = dataOf(a); d.bt = 0; d.gone = false; d.pod = { st: 'empty', beam: 0 }; },
  update(a, dt, ctx) {
    const d = dataOf(a);
    d.bt += dt;
    if (d.bt < 1) d.pod = { st: 'empty', beam: d.bt };
    else if (d.bt < 2.8) d.pod = { st: 'run', mat: (d.bt - 1) / 1.8 };
    else { d.pod = { st: 'run' }; if (d.want !== 'teleport') finish(a, ctx); }
  },
};

export const SCENE_BEHAVIORS: Record<string, BehaviorDef> = {
  type: seated('work'), think: seated('think'), wait: seated('wait'), idle: seated('idle'), sleep: seated('sleep'),
  arrive, leave, talk, minion, poof: poofB,
  running: pod('run'), frozen: pod('frozen'), fire: pod('fire'), dead: pod('dead'), teleport,
};

/** Behaviors that must run to completion before the status mapping takes over again. */
export const ONE_SHOT = new Set(['arrive', 'talk', 'teleport']);

/** Registers the behaviors; with a store, also wires the social pings/hand-offs to its events. */
export function registerSceneBehaviors(store?: Store): () => void {
  for (const [k, v] of Object.entries(SCENE_BEHAVIORS)) registerBehavior(k, v);
  return store ? social.attach(store) : () => {};
}
