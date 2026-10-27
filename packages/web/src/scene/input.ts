/**
 * Pure translation of the store into the world generator's input, plus status → behavior mapping.
 * No Pixi, no DOM: unit-tested under node.
 */
import { renderTemplate, type BehaviorSet, type Entity, type Group, type PaConfig } from '@pixelagents/protocol';
import type { DecorItem, GroupInput, WorldInput, ZoneInput } from '../world/types.js';
import { seasonFromSeed } from '../world/seasons.js';

/** Built-in behavior sets used when the config has none with that name (config wins). */
export const BUILTIN_BEHAVIORS: Record<string, BehaviorSet> = {
  default: { starting: 'arrive', working: 'type', thinking: 'think', waiting: 'wait', idle: 'idle', sleeping: 'sleep', ended: 'leave', '*': 'idle' },
  minion: { '*': 'minion', ended: 'poof' },
  vm: { starting: 'teleport', running: 'running', working: 'running', frozen: 'frozen', paused: 'frozen', failed: 'fire', error: 'fire', ended: 'dead', dead: 'dead', '*': 'running' },
};

/** Behaviors drawn as little characters next to the parent's desk (no desk of their own). */
export const MINI_BEHAVIORS = new Set(['minion', 'poof']);
/** Behaviors drawn inside a lab capsule. */
export const POD_BEHAVIORS = new Set(['running', 'frozen', 'fire', 'dead', 'teleport']);

export function behaviorSetName(e: Pick<Entity, 'view' | 'kind'>): string {
  return (typeof e.view?.behavior === 'string' && e.view.behavior) || 'default';
}

/** config.behaviors[view.behavior ?? 'default'][status] → name, falling back to "*" and the built-ins. */
export function behaviorFor(e: Pick<Entity, 'view' | 'kind' | 'status'>, config: Pick<PaConfig, 'behaviors'> | null): string {
  const name = behaviorSetName(e);
  const sets = [config?.behaviors?.[name], BUILTIN_BEHAVIORS[name], config?.behaviors?.default, BUILTIN_BEHAVIORS.default];
  for (const set of sets) {
    if (!set) continue;
    const b = set[e.status] ?? set['*'];
    if (b) return b;
  }
  return 'idle';
}

/** Where an entity lives in the world. */
export type Placement = 'desk' | 'mini' | 'pod';

export function placementFor(e: Pick<Entity, 'view' | 'kind' | 'status' | 'parent'>, groupKind: string, config: Pick<PaConfig, 'behaviors'> | null): Placement {
  const b = behaviorFor(e, config);
  if (MINI_BEHAVIORS.has(b) || (e.kind === 'subagent' && e.parent)) return 'mini';
  if (groupKind === 'lab' || POD_BEHAVIORS.has(b)) return 'pod';
  return 'desk';
}

export interface InputOptions {
  config: PaConfig | null;
  /** Entities to leave out (gone: finished their exit). */
  exclude?: ReadonlySet<string>;
  /** Today, for the daily seed and the automatic season. */
  now?: Date;
  /** Seed text for `world.seed: "random"` (stable per page load). */
  randomSeed?: string;
  decor?: DecorItem[];
}

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function seedFor(config: PaConfig | null, now: Date, randomSeed = 'random'): string {
  const s = config?.world?.seed ?? 'daily';
  if (s.startsWith('fixed:')) return s.slice(6) || 'fixed';
  if (s === 'random') return randomSeed;
  return dayKey(now);
}

export function seasonFor(config: PaConfig | null, now: Date): string {
  const s = config?.world?.season ?? 'auto';
  return s === 'auto' ? seasonFromSeed(dayKey(now)) : s;
}

/** Group id of an entity: explicit view.group, else the `groups.by` template. */
export function groupOf(e: Entity, config: PaConfig | null): string {
  if (typeof e.view?.group === 'string' && e.view.group) return e.view.group;
  const by = config?.groups?.by ?? '{{labels.host}}';
  return renderTemplate(by, e) || 'default';
}

/** Store groups + entities → GroupInput[] (zones by `groups.zones`, pods for labs). */
export function buildGroups(entities: Iterable<Entity>, groups: Iterable<Group>, o: InputOptions): GroupInput[] {
  const cfg = o.config;
  const zonesTpl = cfg?.groups?.zones ?? '{{labels.repo}}';
  const byId = new Map<string, GroupInput & { zoneMap: Map<string, ZoneInput> }>();
  const order: string[] = [];
  const ensure = (id: string, kind: string, label: string) => {
    let g = byId.get(id);
    if (!g) {
      g = { id, kind, label, zones: [], zoneMap: new Map(), ...(kind === 'lab' ? { pods: [] } : {}) };
      byId.set(id, g); order.push(id);
    }
    return g;
  };
  for (const g of groups) ensure(g.id, g.kind || 'office', g.label || g.id);
  const ents = [...entities].sort((a, b) => (a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : a.id < b.id ? -1 : 1));
  for (const e of ents) {
    if (e.view?.hidden || o.exclude?.has(e.id)) continue;
    const gid = groupOf(e, cfg);
    const g = byId.get(gid) ?? ensure(gid, 'office', gid);
    const where = placementFor(e, g.kind, cfg);
    if (where === 'mini') continue;
    if (where === 'pod') { (g.pods ??= []).push(e.id); continue; }
    const zid = renderTemplate(zonesTpl, e) || g.label || 'main';
    let z = g.zoneMap.get(zid);
    if (!z) { z = { id: zid, label: zid, agents: [] }; g.zoneMap.set(zid, z); g.zones.push(z); }
    z.agents.push(e.id);
  }
  return order.map((id) => {
    const { zoneMap: _z, ...g } = byId.get(id)!;
    void _z;
    return g;
  });
}

export function buildWorldInput(entities: Iterable<Entity>, groups: Iterable<Group>, o: InputOptions): WorldInput {
  const now = o.now ?? new Date();
  return {
    seed: seedFor(o.config, now, o.randomSeed),
    season: seasonFor(o.config, now),
    groups: buildGroups(entities, groups, o),
    decor: o.config?.fun?.decor === false ? [] : o.decor ?? [],
    strategies: o.config?.world?.strategies ?? [],
  };
}
