/** Tiny DOM helpers for the settings UI (no framework). */
type Kid = Node | string | null | undefined | false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>;

let counter = 0;
export function uid(prefix = 'pa'): string {
  return `${prefix}-${++counter}`;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') (el as unknown as Props)[k] = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids) if (kid != null && kid !== false) el.append(kid);
  return el;
}

export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
