import { MAX_SPARE, generateWorld } from './generate.js';
import type { WorldInput, WorldLayout } from './types.js';

/**
 * Next layout for a new input, from the previous one.
 *  - Same offices and every zone keeps between 1 and MAX_SPARE free desks: geometry, roads and
 *    furniture are untouched; agents are (re)assigned to slots (newcomers take free slots, departed
 *    ones free theirs) and the build timeline goes on as it was.
 *  - Otherwise the generator runs incrementally: offices that still fit keep their tiles, offices
 *    that grew are rebuilt in place or relocated, departed offices are demolished. A new seed (next
 *    day) rebuilds the whole town.
 */
export function relayout(prev: WorldLayout, input: WorldInput): WorldLayout {
  if (prev.seed === input.seed && (input.cols ?? prev.cols) === prev.cols) {
    const patched = tryPatch(prev, input);
    if (patched) return patched;
  }
  return generateWorld(input, prev);
}

function tryPatch(prev: WorldLayout, input: WorldInput): WorldLayout | null {
  const groups = input.groups.filter((g, i, a) => a.findIndex((x) => x.id === g.id) === i).slice(0, 12);
  if (groups.length !== prev.offices.length) return null;
  const next: WorldLayout = JSON.parse(JSON.stringify(prev)) as WorldLayout;
  for (const g of groups) {
    const o = next.offices.find((x) => x.id === g.id);
    if (!o || o.kind !== g.kind || o.label !== g.label) return null;
    if ((g.pods !== undefined) !== (o.capsules.length > 0)) return null;
    if (g.zones.length !== o.zones.length) return null;
    for (const z of g.zones) {
      const lz = o.zones.find((x) => x.id === z.id);
      if (!lz) return null;
      lz.label = z.label;
      if (!assign(lz.slots, z.agents)) return null;
    }
    if (g.pods !== undefined && !assign(o.capsules, g.pods)) return null;
  }
  next.order = { offices: prev.order.offices, agents: {} };
  for (const o of next.offices) {
    for (const z of o.zones) next.order.agents[o.id + '/' + z.id] = z.slots.flatMap((s) => (s.agent ? [s.agent] : []));
    if (o.capsules.length) next.order.agents[o.id + '/@pods'] = o.capsules.flatMap((s) => (s.agent ? [s.agent] : []));
  }
  return next;
}

/**
 * Keep present agents where they are, free the departed, seat arrivals in free slots. False when
 * the zone would be left without a free desk or with too many (the generator re-lays it then).
 */
function assign(slots: { agent: string | null }[], wanted: string[]): boolean {
  const want = [...new Set(wanted)];
  const spare = slots.length - want.length;
  if (spare < 1 || spare > MAX_SPARE) return false;
  for (const s of slots) if (s.agent && !want.includes(s.agent)) s.agent = null;
  const seated = new Set(slots.flatMap((s) => (s.agent ? [s.agent] : [])));
  for (const a of want) {
    if (seated.has(a)) continue;
    const free = slots.find((s) => !s.agent);
    if (!free) return false;
    free.agent = a;
  }
  return true;
}
