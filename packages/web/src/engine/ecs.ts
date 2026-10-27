/**
 * Lightweight ECS. Entities are pooled objects owning optional components; systems iterate a dense
 * array with swap-remove. Hot paths (`update`, `forEach`) allocate nothing. No pixi imports, so it
 * runs under node for tests.
 */
import type { SpriteSheet } from './px.js';
import { frameAt } from './px.js';

export interface Transform { x: number; y: number; /** Draw order inside the layer (y-sorted by default). */ z: number; flip: boolean; }

/** Structural subset of a pixi Sprite, so the ECS stays renderer-agnostic. */
export interface SpriteNode {
  x: number; y: number; visible: boolean; zIndex: number;
  texture: unknown;
  scale: { x: number; y: number; set(x: number, y?: number): void };
  anchor?: { set(x: number, y?: number): void };
}

export interface SpriteC {
  sheet: SpriteSheet | null;
  node: SpriteNode | null;
  /** Frame index currently shown (written by the animator or set manually). */
  frame: number;
  layer: 'world' | 'actors' | 'ui' | 'screen';
}
export interface Animator { time: number; tag: string | undefined; playing: boolean; speed: number; }
export interface BehaviorC { name: string; def: unknown; data: Record<string, unknown>; entered: boolean; }
export interface Bubble { text: string; until: number; icon?: string; }
export interface Label { text: string; color: number; }

export class Entity {
  id = 0;
  /** External key (entity id from the server), if any. */
  key = '';
  alive = false;
  index = -1;
  transform: Transform = { x: 0, y: 0, z: 0, flip: false };
  sprite: SpriteC | null = null;
  animator: Animator | null = null;
  behavior: BehaviorC | null = null;
  bubble: Bubble | null = null;
  label: Label | null = null;
  /** Free slot for the world/plugins (e.g. the PaEntity data). */
  data: Record<string, unknown> = {};
}

export interface System { name: string; update(dt: number, world: World): void; }

export class World {
  readonly entities: Entity[] = [];
  private systems: System[] = [];
  private pool: Entity[] = [];
  private byKey = new Map<string, Entity>();
  private nextId = 1;
  /** Monotonic clock in ms, advanced by `update`. */
  time = 0;
  onDestroy: ((e: Entity) => void) | null = null;

  get size(): number { return this.entities.length; }

  create(key = ''): Entity {
    const e = this.pool.pop() ?? new Entity();
    e.id = this.nextId++;
    e.key = key;
    e.alive = true;
    e.index = this.entities.length;
    this.entities.push(e);
    if (key) this.byKey.set(key, e);
    return e;
  }

  get(key: string): Entity | undefined { return this.byKey.get(key); }

  destroy(e: Entity): void {
    if (!e.alive) return;
    this.onDestroy?.(e);
    e.alive = false;
    const last = this.entities.pop()!;
    if (last !== e) { this.entities[e.index] = last; last.index = e.index; }
    if (e.key) this.byKey.delete(e.key);
    e.key = ''; e.index = -1;
    e.transform.x = e.transform.y = e.transform.z = 0; e.transform.flip = false;
    e.sprite = null; e.animator = null; e.behavior = null; e.bubble = null; e.label = null;
    e.data = {};
    this.pool.push(e);
  }

  addSystem(s: System): this { this.systems.push(s); return this; }
  removeSystem(name: string): void { this.systems = this.systems.filter((s) => s.name !== name); }

  /** `dt` in seconds. */
  update(dt: number): void {
    this.time += dt * 1000;
    for (let i = 0; i < this.systems.length; i++) this.systems[i]!.update(dt, this);
  }

  forEach(fn: (e: Entity) => void): void {
    for (let i = 0; i < this.entities.length; i++) fn(this.entities[i]!);
  }
}

/** Advances animators and picks the frame of each sprite. */
export const animatorSystem: System = {
  name: 'animator',
  update(dt, world) {
    const list = world.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      const a = e.animator, s = e.sprite;
      if (!a || !s || !s.sheet) continue;
      if (a.playing) a.time += dt * 1000 * a.speed;
      s.frame = frameAt(s.sheet, a.time, a.tag);
    }
  },
};

/** Writes transform + frame into the sprite nodes. Pixel-snaps the position (pixel-perfect). */
export const spriteSyncSystem: System = {
  name: 'sprite-sync',
  update(_dt, world) {
    const list = world.entities;
    for (let i = 0; i < list.length; i++) {
      const e = list[i]!;
      const s = e.sprite;
      if (!s || !s.node || !s.sheet) continue;
      const n = s.node, t = e.transform, sh = s.sheet;
      const tex = sh.frames[s.frame];
      if (tex !== undefined && n.texture !== tex) n.texture = tex;
      n.scale.x = t.flip ? -1 : 1;
      // A mirrored sprite spans [x - w, x]; keep the anchor column on the same pixel as unflipped.
      n.x = t.flip ? Math.round(t.x) + 1 + sh.anchor[0] : Math.round(t.x) - sh.anchor[0];
      n.y = Math.round(t.y) - sh.anchor[1];
      n.zIndex = t.z || t.y;
    }
  },
};
