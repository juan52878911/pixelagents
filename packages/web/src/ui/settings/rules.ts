import { compilePattern, getPath, renderTemplate, applyRules } from '@pixelagents/protocol';
import type { Entity, GroupsConfig, Rule } from '@pixelagents/protocol';

export interface PreviewGroup { id: string; label: string; kind: string; entities: string[] }
export interface Preview {
  groups: PreviewGroup[];
  /** skin name (or "(none)") → entity ids */
  skins: Record<string, string[]>;
  /** Entities whose office would change versus what the server shows now. */
  moved: { id: string; from: string; to: string }[];
  total: number;
}

/**
 * Classify `entities` with a draft of the rules and group template, the way the server does
 * (rules first, then `groups.by` when no rule set view.group), without saving anything.
 * The current `view` is cleared so the result shows what the draft alone would do; labels that
 * today's rules wrote stay, because they cannot be told apart from labels the sources provided.
 */
export function previewRules(entities: Iterable<Entity>, rules: Rule[], groups: GroupsConfig): Preview {
  const byGroup = new Map<string, PreviewGroup>();
  const skins: Record<string, string[]> = {};
  const moved: Preview['moved'] = [];
  const kinds = Object.entries(groups.kinds ?? {}).map(([glob, kind]) => [compilePattern(glob), kind] as const);
  let total = 0;
  for (const e of entities) {
    total++;
    const fresh = { ...e, view: {} } as Entity;
    const c = rules.length ? applyRules(fresh, rules) : fresh;
    const gid = (c.view.group as string | undefined) || renderTemplate(groups.by, c) || 'default';
    let g = byGroup.get(gid);
    if (!g) {
      const kind = kinds.find(([re]) => re.test(gid))?.[1] ?? 'office';
      const label = (groups.label ? renderTemplate(groups.label, c) : '') || gid;
      g = { id: gid, label, kind, entities: [] };
      byGroup.set(gid, g);
    }
    g.entities.push(e.id);
    const skin = (c.view.skin as string | undefined) || '(none)';
    (skins[skin] ??= []).push(e.id);
    const was = e.view?.group as string | undefined;
    if (was && was !== gid) moved.push({ id: e.id, from: was, to: gid });
  }
  return { groups: [...byGroup.values()].sort((a, b) => a.id.localeCompare(b.id)), skins, moved, total };
}

/** Paths worth suggesting in the rule editor: fixed ones plus every label/metric/view key seen in the entities. */
export function entityPaths(entities: Iterable<Entity>): string[] {
  const out = new Set<string>(['kind', 'status', 'parent', 'id', 'view.group', 'view.skin', 'view.behavior', 'view.hidden', 'activity.tool', 'activity.category']);
  for (const e of entities) {
    for (const k of Object.keys(e.labels ?? {})) out.add(`labels.${k}`);
    for (const k of Object.keys(e.metrics ?? {})) out.add(`metrics.${k}`);
    for (const k of Object.keys(e.view ?? {})) out.add(`view.${k}`);
  }
  return [...out].sort();
}

/** Distinct values seen for a path, to help writing patterns. */
export function valuesAt(entities: Iterable<Entity>, path: string, limit = 12): string[] {
  const seen = new Set<string>();
  for (const e of entities) {
    const v = getPath(e, path);
    if (v != null && typeof v !== 'object') seen.add(String(v));
    if (seen.size >= limit) break;
  }
  return [...seen].sort();
}

/** "a, b" → ["a","b"]; a single value stays a string. */
export function parseMatchValue(text: string): string | string[] {
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : (parts[0] ?? '');
}
export function formatMatchValue(v: string | string[]): string {
  return Array.isArray(v) ? v.join(', ') : v;
}

/** Text typed for a `set` value: JSON literals (true, 3, {"a":1}) are parsed, anything else stays a string/template. */
export function parseSetValue(text: string): unknown {
  const t = text.trim();
  if (t === 'true' || t === 'false' || t === 'null' || /^-?\d+(\.\d+)?$/.test(t) || /^[[{]/.test(t)) {
    try { return JSON.parse(t); } catch { /* keep as text */ }
  }
  return text;
}
export function formatSetValue(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export const GROUP_SHORTCUTS: { label: string; by: string }[] = [
  { label: 'by team', by: '{{labels.team}}' },
  { label: 'by account', by: '{{labels.account}}' },
  { label: 'by repo', by: '{{labels.repo}}' },
  { label: 'by host', by: '{{labels.host}}' },
];
