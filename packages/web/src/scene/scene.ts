/**
 * The living town: store (SSE /events) → world layout → painted world + one ECS actor per entity.
 * World art is static (cached layer); everything that moves is painted into the actors layer every
 * frame from the actors' render state, in the prototype's order.
 */
import type { Entity, PaConfig } from '@pixelagents/protocol';
import { type Actor, type BehaviorContext, setBehavior } from '../engine/behaviors.js';
import type { Engine } from '../engine/engine.js';
import type { Entity as EcsEntity } from '../engine/ecs.js';
import { BufferPainter } from '../engine/painter.js';
import { PainterLayer } from '../engine/painter-gpu.js';
import { generateWorld, relayout } from '../world/index.js';
import { GY, type DecorItem, type OfficeLayout, type WorldLayout } from '../world/types.js';
import type { Store, StoreChange } from '../store.js';
import type { SceneApi } from '../ui/types.js';
import { GAGS } from '../../../../plugins/pop/src/client/index.js';
import { type ActorData, newActorData } from './actor.js';
import { Art } from './art.js';
import { ONE_SHOT, clock, dataOf, registerSceneBehaviors } from './behaviors.js';
import { OL, builderLook, drawChar, drawItem, drawItemSeated, lookFor, strHash, type Look } from './chars.js';
import { EMOJI_DUR, emojiAt, gagAt, allowedGags } from './fun.js';
import { drawIcon } from './icons.js';
import { behaviorFor, buildWorldInput, groupOf, placementFor } from './input.js';
import {
  RUGS, bubble, drawBuilder, drawChair, drawDeco, drawDeskBuilt, drawDoor, drawMinis, drawMonitor, drawPig, drawPod,
  drawRug, drawThermo, hash, poof, sayBubble, talkBubble, txtW, type PodState,
} from './props.js';
import { paintConstruction, paintWorld, worldSize, type WorldArt } from './worldpaint.js';

const LEGS = [1, 0, 2, 0];

export interface SceneOptions {
  engine: Engine;
  store: Store;
  /** Overlay root for the DOM tooltip. */
  root: HTMLElement;
  now?: () => Date;
}

interface OfficeRt { o: OfficeLayout; idx: number; gid: string }

export class Scene implements SceneApi {
  readonly art: Art;
  layout: WorldLayout | null = null;
  private engine: Engine;
  private store: Store;
  private root: HTMLElement;
  private now: () => Date;
  private config: PaConfig | null = null;
  private worldArt: WorldArt | null = null;
  private worldLayer: PainterLayer | null = null;
  private dyn: PainterLayer | null = null;
  private inputKey = '';
  private geoKey = '';
  /** Scene time at which the current world started building (seconds). */
  private buildT0 = -1e9;
  private building = false;
  private actors = new Map<string, Actor>();
  private removed = new Set<string>();
  private selectCbs: ((id: string | null) => void)[] = [];
  private selected: string | null = null;
  private hl: Set<string> | null = null;
  private tip: HTMLDivElement;
  private ctx: BehaviorContext;
  private randomSeed = Math.random().toString(36).slice(2, 8);
  private dirty = true;
  private offices: OfficeRt[] = [];
  private talkNext = new Map<string, number>();

  constructor(o: SceneOptions) {
    this.engine = o.engine; this.store = o.store; this.root = o.root;
    this.now = o.now ?? (() => new Date());
    this.art = new Art(this.engine.lib);
    registerSceneBehaviors();
    this.ctx = { world: this.engine.ecs, width: this.engine.width, height: this.engine.height, dt: 0 };
    this.tip = document.createElement('div');
    Object.assign(this.tip.style, {
      position: 'absolute', pointerEvents: 'none', display: 'none', font: '12px ui-monospace, Menlo, monospace', color: '#ffe9a8',
      background: 'rgba(20,17,27,0.92)', border: '1px solid #3a3346', padding: '4px 6px', whiteSpace: 'pre', zIndex: '5', maxWidth: '420px',
      overflow: 'hidden', textOverflow: 'ellipsis',
    });
    this.root.appendChild(this.tip);
    this.engine.ecs.addSystem({ name: 'scene', update: (dt) => this.frame(dt) });
    this.bindPointer();
    this.config = this.store.config;
    this.store.subscribe((c) => this.onChange(c));
    if (this.store.entities.size || this.store.groups.size) this.syncAll(true);
  }

  // ---------------- store → actors ----------------

  private onChange(c: StoreChange): void {
    if (c.type === 'config') {
      this.config = c.config;
      this.engine.applyEffects(c.config.effects ?? [], (n) => console.warn(`scene: unknown filter "${n}"`));
      if (c.config.world?.fps) this.engine.setFps(c.config.world.fps);
      for (const a of this.actors.values()) { const d = dataOf(a); d.look = lookFor(d.ent.view?.skin, d.seed, this.config); }
      this.syncAll(false);
    } else if (c.type === 'snapshot') this.syncAll(true);
    else if (c.type === 'delta') {
      for (const e of c.upsert) this.upsert(e, false);
      for (const id of c.remove) this.remove(id);
      this.dirty = true;
    } else if (c.type === 'assets') {
      void this.art.loadServer().then(() => { this.repaintWorld(); });
    }
  }

  private syncAll(initial: boolean): void {
    const seen = new Set<string>();
    for (const e of this.store.entities.values()) { seen.add(e.id); this.upsert(e, initial); }
    for (const id of [...this.actors.keys()]) if (!seen.has(id)) this.remove(id);
    this.dirty = true;
  }

  private upsert(e: Entity, initial: boolean): void {
    let a = this.actors.get(e.id);
    const want = behaviorFor(e, this.config);
    if (e.view?.hidden) { if (a) this.despawn(e.id); return; }
    if (!a) {
      const seed = strHash(e.id);
      a = this.engine.ecs.create(e.id);
      const d = newActorData(e.id, e, lookFor(e.view?.skin, seed, this.config), seed);
      a.data.a = d;
      this.actors.set(e.id, a);
      d.want = want;
      // Entities already there when the page opens sit down directly; ended ones are gone.
      if (initial) {
        if (want === 'leave') { d.gone = true; setBehavior(a, 'leave', this.ctx); }
        else if (want === 'poof') { d.gone = true; setBehavior(a, 'poof', this.ctx); }
        else setBehavior(a, want, this.ctx) || setBehavior(a, 'idle', this.ctx);
      } else {
        const place = placementFor(e, this.store.groups.get(groupOf(e, this.config))?.kind ?? 'office', this.config);
        const first = place === 'desk' && want !== 'leave' ? 'arrive' : place === 'pod' && want === 'running' ? 'teleport' : want;
        setBehavior(a, first, this.ctx) || setBehavior(a, 'idle', this.ctx);
      }
    }
    const d = dataOf(a);
    const skinChanged = d.ent.view?.skin !== e.view?.skin;
    d.ent = e;
    if (skinChanged) d.look = lookFor(e.view?.skin, d.seed, this.config);
    d.want = want;
    const cur = a.behavior?.name;
    if (cur !== want && !d.gone) {
      const busy = cur && ONE_SHOT.has(cur) && !(cur === 'talk' && want !== 'idle');
      if (!busy) setBehavior(a, want, this.ctx) || setBehavior(a, 'idle', this.ctx);
    } else if (d.gone && want !== 'leave' && want !== 'poof' && want !== 'dead') {
      // came back (new session on the same id)
      d.gone = false;
      setBehavior(a, d.place === 'desk' ? 'arrive' : want, this.ctx);
    }
  }

  private remove(id: string): void {
    const a = this.actors.get(id);
    if (!a) return;
    const d = dataOf(a);
    if (d.gone || !d.slot) { this.despawn(id); return; }
    this.removed.add(id);
    d.want = d.place === 'mini' ? 'poof' : 'leave';
    setBehavior(a, d.want, this.ctx);
  }

  private despawn(id: string): void {
    const a = this.actors.get(id);
    if (a) this.engine.despawn(a);
    this.actors.delete(id); this.removed.delete(id);
    this.dirty = true;
  }

  // ---------------- world ----------------

  private decorItems(): DecorItem[] {
    if (this.config?.fun?.decor === false) return [];
    return this.art.where({ kind: 'deco' }).map((s) => ({ id: s.name, w: s.w, h: s.h, place: s.meta?.place === 'wall' ? 'wall' : 'floor' }));
  }

  private rebuild(): void {
    this.dirty = false;
    const exclude = new Set<string>();
    for (const [id, a] of this.actors) if (dataOf(a).gone) exclude.add(id);
    for (const e of this.store.entities.values()) if (!this.actors.has(e.id)) exclude.add(e.id);
    const input = buildWorldInput(this.store.entities.values(), this.store.groups.values(), {
      config: this.config, exclude, now: this.now(), randomSeed: this.randomSeed, decor: this.decorItems(),
    });
    input.cols = Math.max(24, Math.floor((this.config?.world?.width ?? this.engine.width) / 8));
    const key = JSON.stringify(input);
    if (key !== this.inputKey) {
      this.inputKey = key;
      this.layout = this.layout ? relayout(this.layout, input) : generateWorld(input);
      const geo = JSON.stringify([this.layout.seed, this.layout.season, this.layout.rows, this.layout.offices.map((o) => [o.id, o.tx, o.ty, o.tw, o.th, o.strategy]), this.layout.path.length]);
      if (geo !== this.geoKey) {
        this.geoKey = geo;
        this.repaintWorld();
        this.building = this.config?.world?.builders !== false;
        this.buildT0 = this.building ? clock.t : -1e9;
        if (this.building) this.engine.cacheLayer('world', false);
      }
    }
    this.assignSlots();
  }

  private repaintWorld(): void {
    if (!this.layout) return;
    this.worldArt = paintWorld(this.layout, this.art);
    const { width, height } = worldSize(this.layout);
    if (!this.worldLayer || this.worldLayer.painter.width !== width || this.worldLayer.painter.height !== height) {
      this.engine.cacheLayer('world', false);
      this.worldLayer?.destroy(); this.dyn?.destroy();
      this.worldLayer = new PainterLayer(width, height);
      this.dyn = new PainterLayer(width, height);
      this.engine.layers.world.removeChildren();
      this.engine.layers.world.addChild(this.worldLayer.sprite);
      this.engine.layers.actors.removeChildren();
      this.engine.layers.actors.addChild(this.dyn.sprite);
    }
    this.worldLayer.painter.data.set(this.worldArt.full.data);
    this.worldLayer.painter.dirty = true;
    this.worldLayer.flush();
    if (!this.building) this.engine.cacheLayer('world', true);
  }

  private assignSlots(): void {
    const L = this.layout;
    this.offices = [];
    if (!L) return;
    const bySlot = new Map<string, { dx: number; dy: number; o: OfficeLayout; zone: string | null }>();
    L.offices.forEach((o, idx) => {
      this.offices.push({ o, idx, gid: o.id });
      for (const z of o.zones) for (const s of z.slots) if (s.agent) bySlot.set(s.agent, { dx: s.dx, dy: s.dy, o, zone: z.id });
      for (const s of o.capsules) if (s.agent) bySlot.set(s.agent, { dx: s.dx, dy: s.dy, o, zone: null });
    });
    for (const a of this.actors.values()) {
      const d = dataOf(a);
      const gid = groupOf(d.ent, this.config);
      d.group = gid;
      const kind = this.store.groups.get(gid)?.kind ?? 'office';
      d.place = placementFor(d.ent, kind, this.config);
      const s = bySlot.get(d.id);
      if (s) { d.slot = { dx: s.dx, dy: s.dy }; d.office = s.o; d.zone = s.zone; }
      else { d.slot = null; d.office = d.place === 'mini' ? L.offices.find((o) => o.id === gid) ?? null : null; d.zone = null; }
      if (!a.transform.x && d.slot) { a.transform.x = d.slot.dx + 2; a.transform.y = d.slot.dy - 10; }
    }
  }

  /** Seconds since the current world started building. */
  private get tb(): number { return clock.t - this.buildT0; }
  private built(o: OfficeLayout): boolean { return this.tb >= o.doneAt; }

  // ---------------- frame ----------------

  private frame(dt: number): void {
    clock.t += dt;
    if (this.dirty) this.rebuild();
    for (const [id, a] of this.actors) {
      const d = dataOf(a);
      if (d.gone && (d.slot || d.office) && d.place !== 'mini') { d.slot = null; d.office = null; this.dirty = true; }
      if (d.gone && this.removed.has(id)) this.despawn(id);
    }
    const L = this.layout, wa = this.worldArt;
    if (!L || !wa || !this.worldLayer || !this.dyn) return;
    if (this.building) {
      if (this.tb >= L.build.buildEnd) {
        this.building = false;
        this.worldLayer.painter.data.set(wa.full.data); this.worldLayer.painter.dirty = true; this.worldLayer.flush();
        this.engine.cacheLayer('world', true);
      } else {
        paintConstruction(wa, L, this.tb, this.worldLayer.painter);
        this.worldLayer.flush();
      }
    }
    this.scheduleTalks();
    const g = this.dyn.painter;
    g.clear();
    this.paint(g, clock.t);
    this.dyn.flush();
  }

  private scheduleTalks(): void {
    for (const { o } of this.offices) {
      if (!this.built(o)) continue;
      const next = this.talkNext.get(o.id) ?? clock.t + 6 + (o.x % 7);
      if (clock.t < next) { this.talkNext.set(o.id, next); continue; }
      this.talkNext.set(o.id, clock.t + 16);
      const idle = [...this.actors.values()].filter((a) => { const d = dataOf(a); return d.office === o && d.place === 'desk' && !d.gone && a.behavior?.name === 'idle' && d.slot; });
      if (idle.length < 2) continue;
      const k = Math.floor(clock.t);
      const A = idle[hash(k * 7) % idle.length]!, da = dataOf(A);
      const others = idle.filter((b) => b !== A && dataOf(b).slot!.dy === da.slot!.dy);
      if (!others.length) continue;
      const B = others[hash(k * 13) % others.length]!;
      da.talk = { with: dataOf(B).id, phase: 'walk', x: da.slot!.dx + 3, dir: 1, lt: 0 };
      setBehavior(A, 'talk', this.ctx);
    }
  }

  private dim(id: string, g: BufferPainter): number {
    return g.alpha(this.hl && !this.hl.has(id) ? 0.3 : 1);
  }

  private paint(g: BufferPainter, t: number): void {
    const L = this.layout!;
    const art = this.art;
    const tb = this.tb;
    if (tb >= L.build.buildEnd) for (const d of L.outdoor) drawDeco(g, art, d, t);
    const byOffice = new Map<OfficeLayout, ActorData[]>();
    const minis = new Map<string, ActorData[]>();
    for (const a of this.actors.values()) {
      const d = dataOf(a);
      if (d.place === 'mini') {
        const p = d.ent.parent;
        if (p && !d.gone) { const l = minis.get(p) ?? []; l.push(d); minis.set(p, l); }
        continue;
      }
      if (!d.office || d.gone) continue;
      const l = byOffice.get(d.office) ?? []; l.push(d); byOffice.set(d.office, l);
    }
    // gags & emojis on awake, seated agents of finished offices
    const cand: string[] = [];
    for (const [o, list] of byOffice) if (this.built(o)) for (const d of list) if (d.seat && d.seat !== 'sleep' && d.place === 'desk' && !d.say) cand.push(d.id);
    cand.sort();
    const fun = this.config?.fun;
    const gagIds = Object.keys(GAGS);
    const gag = gagAt(t, fun, gagIds, (id) => GAGS[id]?.dur ?? 2, cand);
    const emojiIds = this.art.where({ kind: 'emoji' }).map((s) => s.name);
    const emo = emojiAt(t, fun, emojiIds, cand);

    this.offices.forEach(({ o, idx: oi }) => {
      if (tb < o.doneAt) return;
      const fresh = tb - o.doneAt;
      const list = byOffice.get(o) ?? [];
      for (const d of o.wallDeco) drawDeco(g, art, d, t);
      for (const d of o.decor) drawDeco(g, art, d, t);
      // rugs: zones with someone at a desk
      for (const z of o.zones) {
        const xs: number[] = [];
        let grow = 0, extra = 0;
        for (const s of z.slots) {
          const d = s.agent ? list.find((x) => x.id === s.agent) : undefined;
          if (!d || d.desk <= 0) continue;
          if (d.desk >= 1) xs.push(s.dx); else { extra = s.dx; grow = Math.max(grow, d.desk); }
        }
        if (!xs.length && !grow) continue;
        const base = xs.length ? xs : [extra];
        const rx = Math.min(...base) - 5, rw = Math.max(...base) + 29 - rx;
        let w = rw;
        if (xs.length && grow) w += Math.round((Math.max(extra + 29 - rx, rw) - rw) * Math.min(1, grow * 1.5));
        drawRug(g, rx, (z.slots[0]?.dy ?? o.deskY) - 26, w, RUGS[strHash(z.id) % RUGS.length]!, z.label.toUpperCase(), xs.length ? 1 : grow);
      }
      const door = list.some((d) => d.door), ding = list.reduce((m, d) => Math.max(m, d.ding), 0);
      drawDoor(g, art, o.x + o.door, o.y, door, ding);
      for (const d of list) if (d.slot && d.desk > 0.3) drawChair(g, art, d.slot.dx + 2, d.slot.dy);
      // walkers in the back lane (behind the desks)
      for (const d of list) if (d.walker) this.drawWalker(g, d, t);
      for (const d of list) if (d.slot && d.desk > 0) drawDeskBuilt(g, art, d.slot.dx, d.slot.dy, d.desk, t, d.seed);
      const greeters = list.filter((d) => d.greet > 1.2);
      for (const d of list) {
        if (!d.slot) continue;
        if (d.talk) { if (d.talk.phase === 'walk' || d.talk.phase === 'talk') drawMonitor(g, d.slot.dx + 13, d.slot.dy - 9, 'off', t, d.seed); continue; }
        if (!d.seat) { if (d.desk >= 1) drawMonitor(g, d.slot.dx + 13, d.slot.dy - 9, 'off', t, d.seed); continue; }
        const pa = this.dim(d.id, g);
        const ex: SeatExtra = {};
        if (gag && gag.agent === d.id) Object.assign(ex, GAGS[gag.id]?.pose?.(gag.p) ?? {});
        if (emo && emo.agent === d.id && emo.p < 0.2) ex.arms = 'up';
        if (d.say) ex.say = d.say;
        if (d.wave) ex.wave = true;
        if (d.showItem) ex.item = d.look.item;
        if (greeters.some((x) => x !== d && x.zone === d.zone)) { ex.say = 'HOLA'; ex.wave = true; }
        const st = d.talkedBy ? 'talk' : d.seat;
        const speaking = !!d.talkedBy && Math.floor(d.talkedBy.lt / 0.9) % 2 === 1;
        this.drawSeat(g, d, st, t, speaking, ex);
        const cx = d.slot.dx + 2, cy = d.slot.dy - 10;
        if (gag && gag.agent === d.id) GAGS[gag.id]?.draw(g, cx, cy, gag.p, t);
        if (emo && emo.agent === d.id) this.drawEmoji(g, cx, cy, emo.id, emo.p, t);
        const kids = minis.get(d.id);
        if (kids) kids.forEach((m, i) => {
          if (!m.mini) return;
          const mx = d.slot!.dx + 1 + i * 8, my = d.slot!.dy + 14;
          if (m.mini.alpha > 0) drawMinis(g, art, mx, my, m.look, 1, t + i, m.mini.alpha);
          if (m.mini.poof != null) poof(g, mx + 3, my + 4, m.mini.poof);
        });
        if (this.selected === d.id) this.drawMarker(g, cx + 4, cy - 14, t);
        g.alpha(pa);
      }
      // visitors walking below the desks
      for (const d of list) {
        if (!d.talk || !d.slot) continue;
        const wy = d.slot.dy + 8, x = Math.round(d.talk.x);
        const pa = this.dim(d.id, g);
        g.rect(x + 2, wy + 14, 7, 1, 'rgba(0,0,0,0.3)');
        if (d.talk.phase === 'walk') {
          const f = LEGS[Math.floor(t * 8) % 4]!;
          drawChar(g, art, x, wy, d.look, { view: 'side', flip: d.talk.dir < 0, legs: f, hand: f === 1 ? 1 : 0 });
        } else {
          const speaking = Math.floor(d.talk.lt / 0.9) % 2 === 0;
          drawChar(g, art, x, wy, d.look, { face: speaking && Math.floor(t * 8) % 2 ? 'talk' : null, legs: 0 });
          if (speaking) talkBubble(g, art, x + 7, wy - 8, t + 3);
        }
        g.alpha(pa);
      }
      if (fresh < 0.6) for (const d of list) if (d.slot && d.place === 'desk') poof(g, d.slot.dx + 12, d.slot.dy - 2, fresh / 0.6);
      // server racks blinking
      for (let i = 0; i < o.racks; i++) for (let j = 0; j < 6; j++) {
        const rx = o.x + 6 + i * 16, ry = o.y + 23 + j * 4, on = hash(i * 13 + j * 7 + Math.floor(t * 3)) % 3 !== 0;
        g.px(rx + 2, ry, on ? (j % 3 ? '#5dff9b' : '#ffb84d') : '#1b3a26');
        g.px(rx + 4, ry, hash(i + j * 5 + Math.floor(t * 5)) % 2 ? '#5dff9b' : '#1b3a26');
      }
      if (o.capsules.length) this.drawLab(g, o, list, t, fresh);
      this.drawGauges(g, o, oi, t, fresh, list);
    });
    if (tb < L.build.buildEnd) this.drawBuilders(g, L, t);
  }

  private drawWalker(g: BufferPainter, d: ActorData, t: number): void {
    const w = d.walker!;
    const pa = g.alpha(w.alpha != null ? Math.max(0, w.alpha) * (this.hl && !this.hl.has(d.id) ? 0.3 : 1) : this.hl && !this.hl.has(d.id) ? 0.3 : 1);
    drawChar(g, this.art, w.x, w.y, d.look, { view: w.view, flip: w.flip, legs: w.legs, hand: w.hand });
    if (w.item) drawItem(g, this.art, w.x, w.y, d.look.item, w.view, !!w.flip, w.hand ?? 0, t);
    g.alpha(pa);
  }

  /** Chair is already drawn; agent + hands + monitor + bubble + category icon (port of drawSeat). */
  private drawSeat(g: BufferPainter, d: ActorData, st: string, t: number, speaking: boolean, ex: SeatExtra): void {
    const art = this.art, p = d.look.pal, dx = d.slot!.dx, dy = d.slot!.dy, cx = dx + 2, cy = dy - 10, ph = d.seed * 0.37 % 7;
    const blink = ((t + ph) % 3.7) < 0.12;
    let face: 'blink' | 'sleep' | 'talk' | null = blink ? 'blink' : null, y = cy;
    if (st === 'sleep') { face = 'sleep'; y = cy + 1; }
    if (st === 'talk' && speaking && Math.floor(t * 8) % 2) face = 'talk';
    if (ex.lift) y -= Math.round(ex.lift);
    const sink = (ex.lift ?? 0) < 0;
    const prevClip = sink ? g.clip([cx - 4, dy - 40, cx + 14, dy]) : null;
    drawChar(g, art, cx, y, d.look, { face, pose: ex.arms === 'up' ? 'up' : undefined });
    if (sink) g.clip(prevClip);
    if (st === 'work') {
      const a = Math.floor(t * 9 + ph) % 2;
      g.px(cx + 2, dy - a, p.S!); g.px(cx + 7, dy - (1 - a), p.S!);
    } else if (st === 'think') {
      g.px(cx + 7, cy + 5, p.S!); g.rect(cx + 7, cy + 6, 1, 2, p.b!); g.px(cx + 2, dy, p.S!);
    } else { g.px(cx + 2, dy, p.S!); g.px(cx + 7, dy, p.S!); }
    const ms = st === 'talk' ? 'think' : st === 'idle' ? 'think' : st;
    drawMonitor(g, dx + 13, dy - 9, ms as 'work', t, d.seed);
    if (ex.item) drawItemSeated(g, art, dx, dy, ex.item, t);
    if (ex.wave) { const w = Math.floor(t * 6) % 2; g.px(cx + 8 + w, cy + 3, p.S!); g.rect(cx + 8, cy + 4, 1, 3, p.b!); }
    // what it is doing, at a glance
    const cat = d.ent.activity?.category;
    if ((st === 'work' || st === 'think' || st === 'wait') && cat && cat !== 'other') drawIcon(g, cat, dx - 6, dy - 16);
    if (ex.say) { sayBubble(g, cx + 6, cy - 12, ex.say); return; }
    if (st === 'think') {
      if (!art.draw(g, 'bubble.think', cx + 7, cy - 9, { noAnchor: true, frame: Math.floor(t * 3) % 4 })) {
        bubble(g, cx + 7, cy - 9, 11, 7, '#ffffff');
        const n = Math.floor(t * 3) % 4;
        for (let i = 0; i < n; i++) g.px(cx + 9 + i * 3, cy - 6, OL);
      }
    } else if (st === 'wait') {
      // blinking "!" bubble: bobs, and flashes so a waiting agent is seen across the town
      const b = Math.floor(t * 4) % 2, on = Math.floor(t * 2.5) % 4 !== 3;
      if (on && !art.draw(g, 'bubble.wait', cx + 8, cy - 11 - b, { noAnchor: true })) {
        bubble(g, cx + 8, cy - 11 - b, 7, 9, '#ffd23f');
        g.rect(cx + 11, cy - 9 - b, 1, 3, OL); g.px(cx + 11, cy - 5 - b, OL);
      }
    } else if (st === 'sleep') {
      for (let i = 0; i < 3; i++) {
        const q = (t * 0.5 + i / 3) % 1;
        const pa = g.alpha(1 - q);
        g.text('Z', cx + 8 + Math.round(q * 5), cy - 2 - Math.round(q * 11), '#dfe7ff');
        g.alpha(pa);
      }
    } else if (st === 'talk' && speaking) talkBubble(g, art, cx + 7, cy - 9, t);
  }

  private drawEmoji(g: BufferPainter, cx: number, cy: number, id: string, p: number, t: number): void {
    const pa = p > 0.7 ? g.alpha(Math.max(0, (1 - p) / 0.3)) : g.alpha(1);
    this.art.draw(g, id, Math.round(cx + 1 + p * 8), Math.round(cy - 6 - Math.sin(p * Math.PI) * 12 - p * 4), { t, noAnchor: true });
    g.alpha(pa);
    void EMOJI_DUR;
  }

  private drawMarker(g: BufferPainter, x: number, y: number, t: number): void {
    const b = Math.floor(t * 3) % 2;
    g.rect(x - 2, y - 3 + b, 5, 1, '#ffe9a8'); g.rect(x - 1, y - 2 + b, 3, 1, '#ffe9a8'); g.px(x, y - 1 + b, '#ffe9a8');
  }

  private drawLab(g: BufferPainter, o: OfficeLayout, list: ActorData[], t: number, fresh: number): void {
    const counts: Record<string, number> = { run: 0, fire: 0, frozen: 0, dead: 0 };
    let lastX = o.x;
    for (const s of o.capsules) {
      const d = s.agent ? list.find((x) => x.id === s.agent) : undefined;
      const st: PodState = d?.pod?.st ?? 'empty';
      if (counts[st] != null) counts[st]++;
      const look = d?.look ?? lookFor('default', 7, this.config);
      const pa = d ? this.dim(d.id, g) : g.alpha(1);
      drawPod(g, this.art, s.dx, s.dy, look, d?.seed ?? 0, st, t, d?.pod ?? {});
      const nm = (d?.ent.labels?.name ?? d?.id.split(':').pop() ?? '').toUpperCase().slice(0, 6);
      if (nm) g.text(nm, s.dx + Math.round((22 - txtW(nm)) / 2), s.dy + 33, '#cfd6de');
      if (d && this.selected === d.id) this.drawMarker(g, s.dx + 11, s.dy - 4, t);
      g.alpha(pa);
      if (fresh < 0.6) poof(g, s.dx + 11, s.dy + 14, fresh / 0.6);
      lastX = Math.max(lastX, s.dx + 22);
    }
    const px = lastX + 8, py = (o.capsules[0]?.dy ?? o.y + 46);
    if (px + 46 > o.x + o.w - 28) return;
    g.rect(px - 4, py - 4, 46, 44, '#1f2a33'); g.rect(px - 4, py - 4, 46, 1, '#58e1f0'); g.rect(px - 4, py + 39, 46, 1, '#0f151a');
    g.text('MICROVMS', px, py, '#58e1f0');
    ([['VIVAS', counts.run, '#5dff9b'], ['FUEGO', counts.fire, '#ff9a5c'], ['HIELO', counts.frozen, '#9fdcff'], ['RIP', counts.dead, '#a9aeb7']] as const)
      .forEach((r, i) => { g.rect(px, py + 9 + i * 7, 3, 3, r[2]); g.text(r[0] + ' ' + r[1], px + 6, py + 8 + i * 7, '#e6e2ee'); });
    g.text(o.strategy.toUpperCase(), px, py + 36, '#5b7080');
  }

  /** Load thermometer (metric `load`) and piggy bank (sum of cost_usd). */
  private drawGauges(g: BufferPainter, o: OfficeLayout, oi: number, t: number, fresh: number, list: ActorData[]): void {
    const grp = this.store.groups.get(o.id);
    const host = this.store.entities.get('host:' + o.id);
    let load = grp?.metrics?.load ?? host?.metrics?.load;
    if (load == null) {
      const present = list.filter((d) => d.place !== 'mini');
      const busy = present.filter((d) => d.seat === 'work' || d.seat === 'think' || d.pod?.st === 'run').length;
      load = present.length ? (busy / present.length) * 100 : 0;
    }
    const gx = o.x + o.w - 24, lvl = Math.max(1, Math.min(99, Math.round(load + Math.sin(t * 0.7 + oi) * 2)));
    drawThermo(g, gx + 4, o.y + 26, lvl);
    if (lvl >= 80) for (let i = 0; i < 2; i++) { const q = (t + i * 0.5) % 1; const pa = g.alpha(1 - q); g.px(gx + 6 + i * 2, o.y + 24 - Math.round(q * 6), '#ffffff'); g.alpha(pa); }
    const ls = lvl + '%';
    g.text(ls, gx + 6 - Math.round(txtW(ls) / 2), o.y + 61, lvl < 50 ? '#4cc38a' : lvl < 80 ? '#f2c14e' : '#e5533d');
    drawPig(g, this.art, gx, o.y + 72, t, oi * 0.7);
    const s = '$' + this.costOf(o.id).toFixed(2);
    g.text(s, gx + 7 - Math.round(txtW(s) / 2), o.y + 87, '#f5c542');
    if (fresh < 0.6) poof(g, gx + 6, o.y + 50, fresh / 0.6);
  }

  private costOf(gid: string): number {
    let sum = 0;
    for (const e of this.store.entities.values()) if (groupOf(e, this.config) === gid) sum += e.metrics?.cost_usd ?? 0;
    return sum;
  }

  private drawBuilders(g: BufferPainter, L: WorldLayout, t: number): void {
    const tb = this.tb;
    L.offices.forEach((o, oi) => {
      const s = o.buildStart, D = o.buildDur, N = o.order.length;
      if (!N || tb < s - 0.3 || tb > s + D + 0.6) return;
      for (let b = 0; b < 2; b++) {
        const fi = Math.max(0, Math.min(N - 1, ((tb - s) / D) * N));
        let i = Math.floor(fi); if (i % 2 !== b) i = Math.max(0, i - 1);
        const j = Math.min(N - 1, i + 2), f = Math.max(0, Math.min(1, (fi - i) / 2));
        const A = o.order[i]!, B = o.order[j]!;
        const x = A[0] * 8 + 4 + (B[0] - A[0]) * 8 * f - 5, y = GY + A[1] * 8 + 4 + (B[1] - A[1]) * 8 * f - 13;
        const look = builderLook(30 + oi * 2 + b);
        if (tb < s) { poof(g, Math.round(x + 5), Math.round(y + 8), (tb - s + 0.3) / 0.3); continue; }
        if (tb > s + D) { const q = (tb - s - D) / 0.6; if (q < 0.5) drawBuilder(g, this.art, x, y, look, t + b * 0.3); poof(g, Math.round(x + 5), Math.round(y + 8), q); continue; }
        drawBuilder(g, this.art, x, y, look, t + b * 0.3);
      }
    });
  }

  // ---------------- pointer, SceneApi ----------------

  /** World point (logical, camera applied) from a client point. */
  private worldAt(clientX: number, clientY: number): { x: number; y: number } {
    const l = this.engine.toLogical(clientX, clientY), c = this.engine.camera;
    return { x: c.x + l.x / c.zoom, y: c.y + l.y / c.zoom };
  }

  /** Visible box of an actor in world px. */
  private boxOf(d: ActorData): [number, number, number, number] | null {
    if (d.gone) return null;
    if (d.office && !this.built(d.office)) return null;
    if (d.place === 'mini') {
      const pa = d.ent.parent ? this.actors.get(d.ent.parent) : undefined;
      const pd = pa ? dataOf(pa) : null;
      if (!pd?.slot) return null;
      const i = [...this.actors.values()].filter((x) => dataOf(x).ent.parent === d.ent.parent && dataOf(x).place === 'mini' && !dataOf(x).gone).findIndex((x) => dataOf(x).id === d.id);
      return [pd.slot.dx + 1 + i * 8, pd.slot.dy + 14, 6, 9];
    }
    if (d.walker) return [Math.round(d.walker.x), Math.round(d.walker.y), 10, 14];
    if (d.talk && d.slot) return [Math.round(d.talk.x), d.slot.dy + 8, 10, 14];
    if (!d.slot) return null;
    if (d.place === 'pod') return [d.slot.dx, d.slot.dy, 22, 30];
    return [d.slot.dx + 1, d.slot.dy - 12, 12, 14];
  }

  private hit(clientX: number, clientY: number): ActorData | null {
    const p = this.worldAt(clientX, clientY);
    let best: ActorData | null = null;
    for (const a of this.actors.values()) {
      const d = dataOf(a), b = this.boxOf(d);
      if (!b) continue;
      if (p.x >= b[0] - 1 && p.x < b[0] + b[2] + 1 && p.y >= b[1] - 1 && p.y < b[1] + b[3] + 1) best = d;
    }
    return best;
  }

  private bindPointer(): void {
    const cv = this.engine.app.canvas;
    let down: { x: number; y: number } | null = null;
    cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    cv.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
      down = null;
      const d = this.hit(e.clientX, e.clientY);
      this.selected = d?.id ?? null;
      for (const cb of this.selectCbs) cb(this.selected);
    });
    cv.addEventListener('pointermove', (e) => {
      const d = this.hit(e.clientX, e.clientY);
      if (!d) { this.tip.style.display = 'none'; cv.style.cursor = ''; return; }
      cv.style.cursor = 'pointer';
      const e2 = d.ent, act = e2.activity;
      const secs = act?.since ? Math.max(0, Math.round((Date.now() - Date.parse(act.since)) / 1000)) : null;
      const lines = [
        `${e2.labels?.name ?? e2.id}  ·  ${e2.status}`,
        act ? `${act.tool ?? act.category ?? ''}${act.detail ? '  ' + act.detail : ''}${secs != null && secs < 86400 ? `  (${secs}s)` : ''}` : '',
        [e2.labels?.repo, e2.labels?.branch].filter(Boolean).join(' @ '),
      ].filter(Boolean);
      this.tip.textContent = lines.join('\n');
      const r = cv.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
      this.tip.style.left = `${e.clientX - rr.left + 12}px`;
      this.tip.style.top = `${e.clientY - rr.top + 12}px`;
      this.tip.style.display = 'block';
      void r;
    });
    cv.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; });
  }

  onSelect(cb: (entityId: string | null) => void): void { this.selectCbs.push(cb); }

  focus(entityId: string): void {
    const a = this.actors.get(entityId);
    const changed = this.selected !== entityId;
    this.selected = entityId;
    // tell the UI (inspector) only on a real change, so its own focus() calls don't loop
    if (changed) for (const cb of this.selectCbs) cb(entityId);
    if (!a) return;
    const b = this.boxOf(dataOf(a));
    if (!b) return;
    const z = this.engine.camera.zoom, W = this.engine.width, H = this.engine.height;
    const size = this.layout ? worldSize(this.layout) : { width: W, height: H };
    const cx = Math.max(0, Math.min(size.width - W / z, b[0] + b[2] / 2 - W / (2 * z)));
    const cy = Math.max(0, Math.min(Math.max(0, size.height - H / z), b[1] + b[3] / 2 - H / (2 * z)));
    this.engine.setCamera(cx, cy, z);
  }

  highlight(entityIds: string[] | null): void { this.hl = entityIds ? new Set(entityIds) : null; }

  screenPos(entityId: string): { x: number; y: number } | null {
    const a = this.actors.get(entityId);
    if (!a) return null;
    const b = this.boxOf(dataOf(a));
    if (!b) return null;
    const cv = this.engine.app.canvas, r = cv.getBoundingClientRect();
    const o = this.engine.toLogical(r.left, r.top); // logical coords of the canvas origin (negative offset)
    const css = this.engine.effectiveScale / this.engine.app.renderer.resolution;
    const c = this.engine.camera;
    const lx = (b[0] + b[2] / 2 - c.x) * c.zoom, ly = (b[1] - c.y) * c.zoom;
    return { x: (lx - o.x) * css, y: (ly - o.y) * css };
  }

  // ---------------- test hooks ----------------

  actorList(): { id: string; group: string; behavior: string; x: number; y: number; kind: string; status: string; visible: boolean; bubble: string | null }[] {
    return [...this.actors.values()].map((a) => {
      const d = dataOf(a), b = this.boxOf(d);
      const beh = a.behavior?.name ?? '';
      return {
        id: d.id, group: d.group, behavior: beh, x: b ? b[0] : Math.round(a.transform.x), y: b ? b[1] : Math.round(a.transform.y),
        kind: d.ent.kind, status: d.ent.status, visible: !!b,
        bubble: d.say ?? (d.seat === 'wait' ? '!' : d.seat === 'think' ? '...' : d.seat === 'sleep' ? 'Z' : null),
      };
    });
  }

  groupList(): string[] { return this.layout ? this.layout.offices.map((o) => o.id) : []; }

  get buildDone(): boolean { return !!this.layout && this.tb >= this.layout.build.buildEnd; }
}

interface SeatExtra { lift?: number; arms?: 'up'; say?: string; wave?: boolean; item?: string | null }

export type { EcsEntity };
export { allowedGags };
