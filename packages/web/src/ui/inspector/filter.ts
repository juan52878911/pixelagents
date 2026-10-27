import type { Entity } from '@pixelagents/protocol';

export interface Filter { text: string; status: string | null }

/** Text a search looks into: session, repo, team, account, host, branch, model, tool. */
export function haystack(e: Entity): string {
  const l = e.labels;
  return [e.id, l.name, l.session, l.repo, l.team, l.account, l.host, l.branch, l.model, e.activity?.tool, e.activity?.detail]
    .filter(Boolean).join(' ').toLowerCase();
}

export function matches(e: Entity, f: Filter): boolean {
  if (f.status && e.status !== f.status) return false;
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = haystack(e);
  return words.every((w) => h.includes(w));
}

/** Ids matching the filter, or null when the filter is empty (so the scene clears the highlight). */
export function filterIds(entities: Iterable<Entity>, f: Filter): string[] | null {
  if (!f.text.trim() && !f.status) return null;
  const out: string[] = [];
  for (const e of entities) if (e.kind !== 'host' && matches(e, f)) out.push(e.id);
  return out;
}
