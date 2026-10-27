/**
 * Owner: W14. What agents tell each other and how hard they work, drawn as pixels:
 * - pings: one-shot icon bubbles from events (tool failed, context compacted, work handed to a
 *   subagent, result received, permission asked);
 * - hand-offs: a parent stands up in front of its desk (where its minis sit) when it launches a
 *   subagent and when one finishes; the seated behaviors ask `social.consume(id)` for them;
 * - effort: sweat drops when the tool rate is high, sparks when it is very high.
 * Pings use the scene clock (behaviors.ts `clock`), so they pause with the scene.
 */
import type { Entity, PaEvent } from '@pixelagents/protocol';
import type { Painter } from '../engine/painter.js';
import type { Store } from '../store.js';
import type { ActorData } from './actor.js';
import { clock } from './behaviors.js';
import { bubble } from './props.js';

const OL = '#1a1423';
export type PingKind = 'error' | 'compact' | 'delegate' | 'receive' | 'ask' | 'done';
export type HandoffKind = 'delegate' | 'receive';

interface Icon { rows: string[]; pal: Record<string, string> }
/** 7×7 icons drawn inside an 11×11 bubble. */
export const PING_ICONS: Record<PingKind, Icon> = {
  // white X on red: a tool failed
  error: { rows: ['OOOOOOO', 'OwrrrwO', 'OrwrwrO', 'OrrwrrO', 'OrwrwrO', 'OwrrrwO', 'OOOOOOO'], pal: { O: OL, r: '#e5533d', w: '#ffffff' } },
  // striped box: context compacted (zipped)
  compact: { rows: ['.OOOOO.', 'OwOwOwO', 'OOOOOOO', 'OggOggO', 'OggOggO', 'OOOOOOO', '.OwwwO.'], pal: { O: OL, w: '#e9f2f7', g: '#8f96a3' } },
  // clipboard: work handed to a subagent
  delegate: { rows: ['..OOO..', '.OOyOO.', 'OwwwwwO', 'OwOOOwO', 'OwwwwwO', 'OwOOOwO', 'OOOOOOO'], pal: { O: OL, w: '#f5e6c8', y: '#ffd23f' } },
  // white check on green: a subagent brought its result back
  receive: { rows: ['OOOOOOO', 'OgggggO', 'OggggwO', 'OwggwgO', 'OgwwggO', 'OggwggO', 'OOOOOOO'], pal: { O: OL, g: '#4cc38a', w: '#ffffff' } },
  // hand: asking the human
  ask: { rows: ['..O.O..', '.OyOyO.', 'OyOyOyO', 'OyyyyyO', 'OyyyyyO', '.OyyyO.', '..OOO..'], pal: { O: OL, y: '#ffd23f' } },
  // flag: turn finished
  done: { rows: ['O......', 'OOOOOO.', 'ObbwwbO', 'ObwwbbO', 'OOOOOO.', 'O......', 'O......'], pal: { O: OL, b: '#4a90e2', w: '#ffffff' } },
};

const PING_DUR: Record<PingKind, number> = { error: 2.6, compact: 3, delegate: 1.8, receive: 1.8, ask: 2.2, done: 1.2 };
/** Seconds a parent stands in front of its desk for a hand-off. */
export const HANDOFF_SEC = 1.8;
/** Intensity (0..100) thresholds for sweat and sparks. */
export const SWEAT_AT = 45;
export const SPARKS_AT = 80;

interface Ping { kind: PingKind; since: number; until: number }

export class Social {
  readonly pings = new Map<string, Ping>();
  private readonly pending = new Map<string, HandoffKind>();

  /** Subscribes to the store's deltas; returns the unsubscribe function. */
  attach(store: Store): () => void {
    return store.subscribe((c) => { if (c.type === 'delta' && c.events.length) this.onEvents(c.events, store.entities); });
  }

  ping(id: string, kind: PingKind, now = clock.t): void {
    this.pings.set(id, { kind, since: now, until: now + PING_DUR[kind] });
  }

  /** Current ping of an entity, with its progress 0..1, or null. */
  pingOf(id: string, now = clock.t): { kind: PingKind; p: number } | null {
    const p = this.pings.get(id);
    if (!p) return null;
    if (now >= p.until) { this.pings.delete(id); return null; }
    return { kind: p.kind, p: (now - p.since) / (p.until - p.since) };
  }

  /** Hand-off waiting for the seated behavior of `id`; consumed once. */
  consume(id: string): HandoffKind | null {
    const k = this.pending.get(id);
    if (k) this.pending.delete(id);
    return k ?? null;
  }

  onEvents(events: PaEvent[], entities: Map<string, Entity>, now = clock.t): void {
    for (const ev of events) {
      const a = ev.attrs ?? {};
      switch (ev.kind) {
        case 'tool.post':
          if (a.ok === false) this.ping(ev.entity, 'error', now);
          break;
        case 'compact':
          this.ping(ev.entity, 'compact', now);
          break;
        case 'waiting.human':
          this.ping(ev.entity, 'ask', now);
          break;
        case 'turn.end':
          if (!this.pings.has(ev.entity)) this.ping(ev.entity, 'done', now);
          break;
        case 'fork.start':
        case 'fork.end': {
          const parent = ev.parent ?? entities.get(ev.entity)?.parent;
          if (!parent) break;
          const kind: HandoffKind = ev.kind === 'fork.start' ? 'delegate' : 'receive';
          this.pending.set(parent, kind);
          this.ping(parent, kind, now);
          break;
        }
        default:
          break;
      }
    }
  }

  clear(): void { this.pings.clear(); this.pending.clear(); }
}

/** The one instance the behaviors and the scene share. */
export const social = new Social();

function hash(n: number): number { n = (n ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; }

/**
 * Draws the ping bubble (if any) and the effort indicator of an actor whose head is at (cx, cy).
 * Returns true when a bubble was drawn, so the caller skips its own state bubble.
 * `lift` raises only the bubble (e.g. above a zone label), not the effort indicator.
 */
export function drawSocial(g: Painter, d: ActorData, cx: number, cy: number, t: number, lift = 0): boolean {
  drawEffort(g, d, cx, cy, t);
  const ping = social.pingOf(d.id, t);
  if (!ping) return false;
  const ic = PING_ICONS[ping.kind];
  const bob = ping.kind === 'error' ? Math.floor(t * 6) % 2 : 0;
  const bx = cx + 7, by = cy - 13 - bob - lift;
  if (ping.p > 0.8) {
    const pa = g.alpha((1 - ping.p) / 0.2);
    bubble(g, bx, by, 11, 11, '#ffffff');
    g.sprite(ic.rows, bx + 2, by + 2, ic.pal);
    g.alpha(pa);
  } else {
    bubble(g, bx, by, 11, 11, '#ffffff');
    g.sprite(ic.rows, bx + 2, by + 2, ic.pal);
  }
  return true;
}

/** Sweat drops beside the head from SWEAT_AT, sparks around it from SPARKS_AT. */
export function drawEffort(g: Painter, d: ActorData, cx: number, cy: number, t: number): void {
  const level = d.ent.metrics.intensity ?? 0;
  if (level < SWEAT_AT) return;
  const ph = (d.seed % 97) / 97;
  for (let i = 0; i < (level >= SPARKS_AT ? 2 : 1); i++) {
    const q = (t * 1.5 + ph + i * 0.5) % 1;
    const x = cx + 9 + i, y = cy + 1 + Math.round(q * 4);
    g.px(x, y, '#bfe8ff');
    g.px(x, y - 1, '#ffffff');
  }
  if (level < SPARKS_AT) return;
  const f = Math.floor(t * 10);
  for (let i = 0; i < 3; i++) {
    const h = hash(f * 7 + i * 31 + d.seed);
    if (h % 3 === 0) continue;
    const x = cx - 3 + (h % 14), y = cy - 4 + ((h >>> 4) % 9);
    g.px(x, y, (h >>> 8) % 2 ? '#ffd23f' : '#ffffff');
  }
}
