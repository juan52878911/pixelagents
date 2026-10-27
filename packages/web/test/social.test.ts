import { beforeEach, describe, expect, it } from 'vitest';
import type { Entity, PaEvent } from '@pixelagents/protocol';
import { World } from '../src/engine/ecs.js';
import { behaviorSystem, setBehavior } from '../src/engine/behaviors.js';
import { BufferPainter } from '../src/engine/painter.js';
import { newActorData, type ActorData } from '../src/scene/actor.js';
import { clock, registerSceneBehaviors } from '../src/scene/behaviors.js';
import { lookFor } from '../src/scene/chars.js';
import { HANDOFF_SEC, PING_ICONS, SPARKS_AT, SWEAT_AT, drawEffort, drawSocial, social } from '../src/scene/social.js';
import { Store } from '../src/store.js';

const T = '2026-01-15T09:00:00.000Z';
const ent = (id: string, o: Partial<Entity> = {}): Entity =>
  ({ id, kind: id.split(':')[0]!, labels: {}, status: 'working', metrics: {}, firstSeen: T, lastSeen: T, history: [], view: {}, ...o });
const ev = (entity: string, kind: string, attrs?: Record<string, unknown>, parent?: string): PaEvent =>
  ({ ts: T, source: 's', entity, kind, attrs, parent });

function actor(world: World, e: Entity): ActorData {
  const a = world.create(e.id);
  const d = newActorData(e.id, e, lookFor(undefined, 1, null), 1);
  d.slot = { dx: 20, dy: 40 };
  a.data.a = d;
  return d;
}

beforeEach(() => { social.clear(); clock.t = 0; });

describe('social pings', () => {
  it('maps events to icon bubbles that expire', () => {
    const entities = new Map<string, Entity>();
    social.onEvents([ev('agent:a', 'tool.post', { tool: 'Bash', ok: false })], entities, 10);
    expect(social.pingOf('agent:a', 10)).toEqual({ kind: 'error', p: 0 });
    expect(social.pingOf('agent:a', 11.3)!.p).toBeCloseTo(0.5);
    expect(social.pingOf('agent:a', 13)).toBeNull();
    social.onEvents([ev('agent:a', 'tool.post', { tool: 'Bash' })], entities, 10);
    expect(social.pingOf('agent:a', 10)).toBeNull();
    social.onEvents([ev('agent:a', 'compact', { trigger: 'auto' }), ev('agent:b', 'waiting.human'), ev('agent:c', 'turn.end')], entities, 0);
    expect(social.pingOf('agent:a', 0)!.kind).toBe('compact');
    expect(social.pingOf('agent:b', 0)!.kind).toBe('ask');
    expect(social.pingOf('agent:c', 0)!.kind).toBe('done');
    expect(social.pingOf('agent:c', 1.5)).toBeNull();
  });

  it('fork events ping the parent and queue a hand-off, found through the event or the entity', () => {
    const entities = new Map<string, Entity>([['subagent:x', ent('subagent:x', { parent: 'agent:p' })]]);
    social.onEvents([ev('subagent:x', 'fork.start', {}, 'agent:p')], entities, 0);
    expect(social.pingOf('agent:p', 0)!.kind).toBe('delegate');
    expect(social.consume('agent:p')).toBe('delegate');
    expect(social.consume('agent:p')).toBeNull();
    social.onEvents([ev('subagent:x', 'fork.end')], entities, 0);
    expect(social.pingOf('agent:p', 0)!.kind).toBe('receive');
    expect(social.consume('agent:p')).toBe('receive');
    social.onEvents([ev('subagent:orphan', 'fork.start')], entities, 0);
    expect(social.consume('subagent:orphan')).toBeNull();
  });

  it('attaches to a store and reads its delta events', () => {
    const store = new Store();
    store.applySnapshot({ protocol: 1, seq: 0, entities: [], groups: [] });
    const off = registerSceneBehaviors(store);
    store.applyDelta({ seq: 1, upsert: [], events: [ev('agent:z', 'compact')] });
    expect(social.pingOf('agent:z')!.kind).toBe('compact');
    off();
    store.applyDelta({ seq: 2, upsert: [], events: [ev('agent:y', 'compact')] });
    expect(social.pingOf('agent:y')).toBeNull();
  });
});

describe('hand-off behavior', () => {
  it('a seated parent stands in front of its desk for HANDOFF_SEC, then sits back', () => {
    registerSceneBehaviors();
    const world = new World();
    world.addSystem(behaviorSystem(320, 180));
    const d = actor(world, ent('agent:p'));
    const a = world.get('agent:p')!;
    const ctx = { world, width: 320, height: 180, dt: 0 };
    setBehavior(a, 'type', ctx);
    world.update(0.1);
    expect(d.seat).toBe('work');
    expect(d.talk).toBeNull();

    social.onEvents([ev('subagent:p-1', 'fork.start', {}, 'agent:p')], new Map(), 0);
    world.update(0.1);
    expect(d.handoff).toMatchObject({ kind: 'delegate' });
    expect(d.seat).toBeNull();
    expect(d.talk).toEqual({ with: '', phase: 'talk', x: 23, dir: 1, lt: 0.9 });
    world.update(HANDOFF_SEC);
    expect(d.handoff).toBeNull();
    expect(d.talk).toBeNull();
    expect(d.seat).toBe('work');

    // switching behavior mid hand-off cleans up
    social.onEvents([ev('subagent:p-1', 'fork.end', {}, 'agent:p')], new Map(), 0);
    world.update(0.1);
    expect(d.handoff).toMatchObject({ kind: 'receive' });
    setBehavior(a, 'idle', ctx);
    world.update(0.1);
    expect(d.handoff).toBeNull();
    expect(d.talk).toBeNull();
    expect(d.seat).toBe('idle');
  });

  it('actors without a desk ignore hand-offs', () => {
    registerSceneBehaviors();
    const world = new World();
    world.addSystem(behaviorSystem(320, 180));
    const d = actor(world, ent('agent:nodesk'));
    d.slot = null;
    setBehavior(world.get('agent:nodesk')!, 'idle', { world, width: 320, height: 180, dt: 0 });
    social.onEvents([ev('subagent:k', 'fork.start', {}, 'agent:nodesk')], new Map(), 0);
    world.update(0.1);
    expect(d.handoff).toBeNull();
    expect(social.consume('agent:nodesk')).toBe('delegate'); // still queued, never consumed
  });
});

describe('drawing', () => {
  const painted = (g: BufferPainter): number => { let n = 0; for (let i = 3; i < g.data.length; i += 4) if (g.data[i]) n++; return n; };

  it('icons are 7×7 with every key in the palette', () => {
    for (const [k, ic] of Object.entries(PING_ICONS)) {
      expect(ic.rows, k).toHaveLength(7);
      for (const r of ic.rows) {
        expect(r, k).toHaveLength(7);
        for (const ch of r) if (ch !== '.') expect(ic.pal[ch], `${k}: ${ch}`).toBeDefined();
      }
    }
  });

  it('draws a bubble only while a ping lasts, and sweat/sparks by intensity', () => {
    const world = new World();
    const d = actor(world, ent('agent:a'));
    const g = new BufferPainter(64, 64);
    expect(drawSocial(g, d, 20, 30, 0)).toBe(false);
    expect(painted(g)).toBe(0);
    social.ping('agent:a', 'error', 0);
    expect(drawSocial(g, d, 20, 30, 0.5)).toBe(true);
    const withBubble = painted(g);
    expect(withBubble).toBeGreaterThan(60);
    expect(drawSocial(g, d, 20, 30, 5)).toBe(false);

    g.clear();
    d.ent.metrics.intensity = SWEAT_AT - 1;
    drawEffort(g, d, 20, 30, 0);
    expect(painted(g)).toBe(0);
    d.ent.metrics.intensity = SWEAT_AT;
    drawEffort(g, d, 20, 30, 0);
    const sweat = painted(g);
    expect(sweat).toBeGreaterThanOrEqual(2);
    g.clear();
    d.ent.metrics.intensity = SPARKS_AT;
    drawEffort(g, d, 20, 30, 0.37);
    expect(painted(g)).toBeGreaterThan(sweat);
  });
});
