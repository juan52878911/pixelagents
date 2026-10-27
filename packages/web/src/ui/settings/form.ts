import { clone, h, isObj, uid } from './dom.js';

/** JSON Schema fragment (draft 2020-12 subset used by CONFIG_SCHEMA). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Schema = any;
export interface FormError { path: string; message: string }

export interface WidgetCtx {
  path: string[];
  schema: Schema;
  value: unknown;
  optional: boolean;
  label: string;
  commit(v: unknown): void;
}
export interface FormOptions {
  /** Return an element to replace the generic control of a field, or null for the default. */
  widget?: (c: WidgetCtx) => HTMLElement | null;
}
export interface FormHandle {
  el: HTMLElement;
  value(): unknown;
  setErrors(errors: FormError[]): void;
}

export function defaultFor(s: Schema): unknown {
  if (!s || typeof s !== 'object') return null;
  if ('const' in s) return s.const;
  if ('default' in s) return clone(s.default);
  if (s.enum) return s.enum[0];
  if (s.oneOf) return defaultFor(s.oneOf[0]);
  switch (s.type) {
    case 'string': return '';
    case 'number': case 'integer': return typeof s.minimum === 'number' ? s.minimum : 0;
    case 'boolean': return false;
    case 'array': return [];
    case 'object': {
      const o: Record<string, unknown> = {};
      for (const k of s.required ?? []) if (s.properties?.[k]) o[k] = defaultFor(s.properties[k]);
      return o;
    }
  }
  return null;
}

/** Does the value look like it belongs to this (oneOf) variant? Const properties discriminate objects. */
export function fits(s: Schema, v: unknown): boolean {
  if (!s) return true;
  if ('const' in s) return s.const === v;
  if (s.enum) return s.enum.includes(v);
  switch (s.type) {
    case 'string': return typeof v === 'string';
    case 'number': case 'integer': return typeof v === 'number';
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object':
      return isObj(v) && Object.entries(s.properties ?? {}).every(([k, p]) => !(p && typeof p === 'object' && 'const' in (p as object)) || v[k] === (p as { const: unknown }).const);
  }
  return true;
}

export function variantLabel(s: Schema): string {
  if (s.title) return s.title;
  const t = s.properties?.type?.const;
  if (t) return String(t);
  if (s.type === 'array') return 'list';
  return String(s.type ?? 'value');
}

const isFree = (s: Schema): boolean =>
  !s || (typeof s === 'object' && !s.type && !s.oneOf && !s.enum && !('const' in s)) || (s.type === 'object' && s.additionalProperties === true && !s.properties);

/** Builds a form for `schema` filled with `initial`. Values are never rewritten unless the user edits them. */
export function buildForm(schema: Schema, initial: unknown, onChange: (v: unknown) => void, opts: FormOptions = {}, basePath: string[] = []): FormHandle {
  let root = clone(initial);
  const el = h('div', { class: 'pa-form' });

  const ptr = (p: string[]): string => '/' + p.join('/');
  const errSlot = (): HTMLElement => h('div', { class: 'pa-err', 'aria-live': 'polite' });

  function labelled(path: string[], label: string, sch: Schema, control: HTMLElement, id: string): HTMLElement {
    const descId = sch.description ? `${id}-d` : null;
    if (descId) control.setAttribute('aria-describedby', descId);
    return h('div', { class: 'pa-field', 'data-path': ptr(path) },
      h('label', { for: id }, sch.title ?? label),
      control,
      sch.description ? h('small', { id: descId }, sch.description) : null,
      errSlot());
  }

  function node(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string, optional: boolean): HTMLElement {
    const custom = opts.widget?.({ path, schema: sch, value, optional, label, commit });
    if (custom) return custom;
    if (sch && typeof sch === 'object' && 'const' in sch) return h('span', { class: 'pa-const', hidden: true });
    if (sch?.oneOf) return oneOfNode(sch, value, path, commit, label);
    if (isFree(sch)) return jsonNode(sch ?? {}, value, path, commit, label, optional);
    if (sch.enum) return enumNode(sch, value, path, commit, label, optional);
    switch (sch.type) {
      case 'string': return stringNode(sch, value, path, commit, label, optional);
      case 'number': case 'integer': return numberNode(sch, value, path, commit, label, optional);
      case 'boolean': return boolNode(sch, value, path, commit, label);
      case 'array': return arrayNode(sch, value, path, commit, label);
      case 'object': return sch.properties ? objectNode(sch, value, path, commit, label) : mapNode(sch, value, path, commit, label);
    }
    return jsonNode(sch, value, path, commit, label, optional);
  }

  function stringNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string, optional: boolean): HTMLElement {
    const id = uid('f');
    const shown = typeof value === 'string' ? value : '';
    const input = h('input', { id, type: 'text', value: shown, spellcheck: 'false', autocomplete: 'off' });
    input.addEventListener('change', () => {
      if (input.value === shown) return;
      commit(input.value === '' && optional ? undefined : input.value);
    });
    return labelled(path, label, sch, input, id);
  }

  function numberNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string, optional: boolean): HTMLElement {
    const id = uid('f');
    const input = h('input', {
      id, type: 'number', value: typeof value === 'number' ? String(value) : '',
      min: sch.minimum, max: sch.maximum, step: sch.type === 'integer' ? 1 : 'any',
    });
    input.addEventListener('change', () => {
      if (input.value === '') { if (optional && value !== undefined) commit(undefined); return; }
      const n = Number(input.value);
      if (!Number.isFinite(n) || n === value) return;
      commit(sch.type === 'integer' ? Math.round(n) : n);
    });
    return labelled(path, label, sch, input, id);
  }

  function boolNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string): HTMLElement {
    const id = uid('f');
    const now = typeof value === 'boolean' ? value : sch.default === true;
    const input = h('input', { id, type: 'checkbox', checked: now });
    input.addEventListener('change', () => { if (input.checked !== now) commit(input.checked); });
    const descId = sch.description ? `${id}-d` : null;
    if (descId) input.setAttribute('aria-describedby', descId);
    return h('div', { class: 'pa-field pa-check', 'data-path': ptr(path) },
      input, h('label', { for: id }, sch.title ?? label),
      sch.description ? h('small', { id: descId }, sch.description) : null, errSlot());
  }

  function enumNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string, optional: boolean): HTMLElement {
    const id = uid('f');
    const names: string[] = sch.enum.map(String);
    const sel = h('select', { id },
      optional ? h('option', { value: '' }, '(default)') : null,
      ...names.map((o) => h('option', { value: o, selected: String(value) === o }, o)));
    sel.addEventListener('change', () => {
      const picked = sch.enum.find((o: unknown) => String(o) === sel.value);
      if (sel.value === '' && optional) commit(undefined);
      else if (picked !== undefined && picked !== value) commit(picked);
    });
    return labelled(path, label, sch, sel, id);
  }

  function jsonNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string, optional: boolean): HTMLElement {
    const id = uid('f');
    const text = value === undefined ? '' : JSON.stringify(value, null, 2);
    const ta = h('textarea', { id, rows: value === undefined ? 2 : Math.min(10, text.split('\n').length + 1), spellcheck: 'false', class: 'pa-json' });
    ta.value = text;
    const msg = h('div', { class: 'pa-err', 'aria-live': 'polite' });
    ta.addEventListener('change', () => {
      if (ta.value === text) return;
      msg.textContent = ''; ta.removeAttribute('aria-invalid');
      if (ta.value.trim() === '') { if (optional) commit(undefined); return; }
      try { commit(JSON.parse(ta.value)); } catch (e) { ta.setAttribute('aria-invalid', 'true'); msg.textContent = `Invalid JSON: ${(e as Error).message}`; }
    });
    const f = labelled(path, label, sch, ta, id);
    f.append(msg);
    return f;
  }

  function oneOfNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string): HTMLElement {
    const variants: Schema[] = sch.oneOf;
    const idx = Math.max(0, variants.findIndex((v) => fits(v, value)));
    const wrap = h('div', { class: 'pa-field pa-oneof', 'data-path': ptr(path) });
    const id = uid('f');
    if (variants.length > 1) {
      const pick = h('select', { id }, ...variants.map((v, i) => h('option', { value: String(i), selected: i === idx }, variantLabel(v))));
      pick.addEventListener('change', () => {
        if (Number(pick.value) === idx) return;
        const target = variants[Number(pick.value)];
        const nv = defaultFor(target);
        if (isObj(nv) && isObj(value) && target.properties) {
          for (const k of Object.keys(target.properties)) if (k in value && !('const' in target.properties[k])) nv[k] = value[k];
        }
        commit(nv);
        // The parent re-renders on structural change through its own redraw; make the switch visible right away.
        body.replaceChildren(node(target, nv, path, commit, label, false));
      });
      wrap.append(h('label', { for: id }, `${sch.title ?? label} type`), pick);
    }
    const body = h('div', { class: 'pa-oneof-body' });
    body.append(node(variants[idx], value, path, commit, label, false));
    wrap.append(body, errSlot());
    return wrap;
  }

  function objectNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string): HTMLElement {
    let cur: Record<string, unknown> = isObj(value) ? value : {};
    const fs = h('fieldset', { class: 'pa-field pa-object', 'data-path': ptr(path) }, path.length ? h('legend', null, sch.title ?? label) : null);
    const req: string[] = sch.required ?? [];
    for (const [k, ps] of Object.entries<Schema>(sch.properties)) {
      if (ps && typeof ps === 'object' && 'const' in ps) continue;
      fs.append(node(ps, cur[k], [...path, k], (v) => {
        cur = { ...cur };
        if (v === undefined) delete cur[k]; else cur[k] = v;
        commit(cur);
      }, k, !req.includes(k)));
    }
    fs.append(errSlot());
    return fs;
  }

  function arrayNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string): HTMLElement {
    let arr: unknown[] = Array.isArray(value) ? value : [];
    const fs = h('fieldset', { class: 'pa-field pa-array', 'data-path': ptr(path) }, h('legend', null, sch.title ?? label));
    const list = h('div', { class: 'pa-list' });
    const draw = (): void => {
      list.replaceChildren();
      arr.forEach((item, i) => {
        const child = node(sch.items, item, [...path, String(i)], (v) => { arr = [...arr]; arr[i] = v; commit(arr); }, `${label} #${i + 1}`, false);
        const rm = h('button', { type: 'button', class: 'pa-btn pa-small', 'aria-label': `Remove ${label} #${i + 1}`, onclick: () => { arr = arr.filter((_, j) => j !== i); commit(arr); draw(); } }, '✕');
        list.append(h('div', { class: 'pa-row' }, child, rm));
      });
    };
    draw();
    const add = h('button', { type: 'button', class: 'pa-btn', onclick: () => { arr = [...arr, defaultFor(sch.items)]; commit(arr); draw(); } }, `Add ${label}`);
    fs.append(list, add, errSlot());
    return fs;
  }

  function mapNode(sch: Schema, value: unknown, path: string[], commit: (v: unknown) => void, label: string): HTMLElement {
    let cur: Record<string, unknown> = isObj(value) ? value : {};
    const addSchema = isObj(sch.additionalProperties) ? sch.additionalProperties : { type: 'string' };
    const fs = h('fieldset', { class: 'pa-field pa-map', 'data-path': ptr(path) }, h('legend', null, sch.title ?? label));
    const list = h('div', { class: 'pa-list' });
    const draw = (): void => {
      list.replaceChildren();
      for (const key of Object.keys(cur)) {
        const keyInput = h('input', { id: uid('f'), type: 'text', value: key, 'aria-label': `${label} key`, class: 'pa-key', spellcheck: 'false' });
        keyInput.addEventListener('change', () => {
          const nk = keyInput.value.trim();
          if (!nk || nk === key || nk in cur) { keyInput.value = key; return; }
          cur = Object.fromEntries(Object.entries(cur).map(([k, v]) => [k === key ? nk : k, v]));
          commit(cur); draw();
        });
        const child = node(addSchema, cur[key], [...path, key], (v) => { cur = { ...cur, [key]: v }; commit(cur); }, key, false);
        const rm = h('button', { type: 'button', class: 'pa-btn pa-small', 'aria-label': `Remove ${key}`, onclick: () => { const { [key]: _gone, ...rest } = cur; cur = rest; commit(cur); draw(); } }, '✕');
        list.append(h('div', { class: 'pa-row pa-maprow' }, keyInput, child, rm));
      }
    };
    draw();
    const newKey = h('input', { id: uid('f'), type: 'text', 'aria-label': `New ${label} key`, placeholder: 'new key', class: 'pa-key', spellcheck: 'false' });
    const addBtn = h('button', { type: 'button', class: 'pa-btn', onclick: () => {
      const k = newKey.value.trim();
      if (!k || k in cur) return;
      cur = { ...cur, [k]: defaultFor(addSchema) }; newKey.value = ''; commit(cur); draw();
    } }, 'Add');
    fs.append(list, h('div', { class: 'pa-row' }, newKey, addBtn), errSlot());
    return fs;
  }

  el.append(node(schema, root, basePath, (v) => { root = v; onChange(v); }, basePath[basePath.length - 1] ?? 'config', false));

  return {
    el,
    value: () => root,
    setErrors(errors) {
      for (const e of el.querySelectorAll('.pa-err')) e.textContent = '';
      for (const e of el.querySelectorAll('[aria-invalid="true"]')) e.removeAttribute('aria-invalid');
      const nodes = [...el.querySelectorAll<HTMLElement>('[data-path]')];
      for (const err of errors) {
        let p = err.path === '/' ? '' : err.path.replace(/\/$/, '');
        for (;;) {
          const target = nodes.find((n) => n.dataset.path === (p === '' ? '/' : p));
          if (target) {
            const slot = [...target.children].find((c) => c.classList.contains('pa-err'));
            if (slot) slot.textContent = (slot.textContent ? slot.textContent + ' · ' : '') + (p === err.path ? err.message : `${err.path}: ${err.message}`);
            target.querySelector('input,select,textarea')?.setAttribute('aria-invalid', 'true');
            break;
          }
          const cut = p.lastIndexOf('/');
          if (cut <= 0) break;
          p = p.slice(0, cut);
        }
      }
    },
  };
}
