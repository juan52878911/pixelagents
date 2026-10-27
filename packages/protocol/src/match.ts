import type { Rule } from './config.js';

/** Read a dotted path ("labels.account") from an object. */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Write a dotted path, creating objects on the way. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]!] = value;
}

const globCache = new Map<string, RegExp>();
/** "/re/" is a regex, otherwise a glob where * is any run of characters and ? one character. */
export function compilePattern(p: string): RegExp {
  let re = globCache.get(p);
  if (re) return re;
  if (p.length > 1 && p.startsWith('/') && p.endsWith('/')) re = new RegExp(p.slice(1, -1));
  else re = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  globCache.set(p, re);
  return re;
}

export function matches(obj: unknown, match: Rule['match']): boolean {
  for (const [path, want] of Object.entries(match)) {
    const v = getPath(obj, path);
    const s = v == null ? '' : String(v);
    const pats = Array.isArray(want) ? want : [want];
    if (!pats.some((p) => compilePattern(p).test(s))) return false;
  }
  return true;
}

/** "{{labels.host}}-{{kind}}" → values from obj; missing paths become "". */
export function renderTemplate(tpl: string, obj: unknown): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    const v = getPath(obj, path);
    return v == null ? '' : String(v);
  });
}

/** Apply every matching rule in order to a copy of obj; string values are templates. */
export function applyRules<T extends object>(obj: T, rules: Rule[]): T {
  const out = structuredClone(obj) as T & Record<string, unknown>;
  for (const rule of rules) {
    if (!matches(out, rule.match)) continue;
    for (const [path, value] of Object.entries(rule.set)) {
      setPath(out, path, typeof value === 'string' ? renderTemplate(value, out) : value);
    }
  }
  return out;
}
