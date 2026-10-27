import type { PaConfig } from '@pixelagents/protocol';
import { clone, h, uid } from './dom.js';
import { buildForm, defaultFor, type FormOptions, type FormHandle, type Schema, variantLabel } from './form.js';
import type { SectionView, SettingsState } from './state.js';

/** A generated form for one or more top-level config keys. */
export function schemaForm(st: SettingsState, key: keyof PaConfig, opts: FormOptions = {}): FormHandle {
  const sch = st.schema.properties[key];
  const form = buildForm({ ...sch, title: sch.title ?? String(key) }, st.draft[key], (v) => st.update(key, v as never), opts, [String(key)]);
  return form;
}

export function multiForm(st: SettingsState, keys: (keyof PaConfig)[], opts: FormOptions = {}): SectionView {
  const el = h('div', { class: 'pa-stack' });
  const forms = keys.map((k) => schemaForm(st, k, opts));
  for (const f of forms) el.append(f.el);
  const setErrors = (errs: { path: string; message: string }[]): void => { for (const f of forms) f.setErrors(errs); };
  setErrors(st.errors);
  return { el, setErrors };
}

/** Sources: generated list with an adapter picker fed by the plugins, and an "add by type" bar. */
export function sourcesSection(st: SettingsState): SectionView {
  const adapters = st.plugins.flatMap((p) => p.adapters.map((a) => ({ name: a, plugin: p.name })));
  const listId = uid('adapters');
  const datalist = h('datalist', { id: listId }, ...adapters.map((a) => h('option', { value: a.name }, a.plugin)));
  const itemsSchema: Schema = st.schema.properties.inputs.items;
  const variants: Schema[] = itemsSchema.oneOf;
  const pluginTypes = [...new Set(st.plugins.flatMap((p) => p.inputs))].filter((t) => !variants.some((v) => v.properties?.type?.const === t));

  const form = schemaForm(st, 'inputs', {
    widget: ({ path, schema, value, label, commit }) => {
      if (path[path.length - 1] !== 'adapter' || path[0] !== 'inputs') return null;
      const id = uid('f');
      const input = h('input', { id, type: 'text', list: listId, value: typeof value === 'string' ? value : '', spellcheck: 'false', autocomplete: 'off' });
      const known = adapters.find((a) => a.name === value);
      input.addEventListener('change', () => { if (input.value !== value) commit(input.value); });
      return h('div', { class: 'pa-field', 'data-path': '/' + path.join('/') },
        h('label', { for: id }, schema.title ?? label),
        input,
        h('small', null, known ? `Provided by plugin ${known.plugin}.` : adapters.length ? `Adapters announced by plugins: ${adapters.map((a) => a.name).join(', ')}` : 'No plugin announces adapters.'),
        h('div', { class: 'pa-err', 'aria-live': 'polite' }));
    },
  });

  const typeSel = h('select', { id: uid('f'), 'aria-label': 'Type of the new source' },
    ...variants.map((v) => h('option', { value: v.properties.type.const }, `${v.properties.type.const} — ${variantLabel(v)}`)));
  const addBtn = h('button', { type: 'button', class: 'pa-btn pa-primary', onclick: () => {
    const v = variants.find((x) => x.properties.type.const === typeSel.value)!;
    const item = defaultFor(v) as Record<string, unknown>;
    const taken = new Set(st.draft.inputs.map((i) => i.id));
    let n = 1; while (taken.has(`${typeSel.value}-${n}`)) n++;
    item.id = `${typeSel.value}-${n}`;
    if (v.properties.adapter && adapters[0]) item.adapter = adapters[0].name;
    st.update('inputs', [...clone(st.draft.inputs), item as never]);
    st.rerender();
  } }, 'Add source');

  const el = h('div', { class: 'pa-stack' },
    h('p', { class: 'pa-help' }, 'Where events come from. Each source feeds an adapter that turns its records into events. Uncheck "enabled" to pause a source without deleting it.'),
    h('div', { class: 'pa-row' }, h('label', { for: typeSel.id }, 'New source'), typeSel, addBtn),
    pluginTypes.length ? h('p', { class: 'pa-help' }, `Plugins also announce source types (${pluginTypes.join(', ')}); the server schema does not accept them yet, so they can only be added in Advanced.`) : null,
    datalist, form.el);
  form.setErrors(st.errors);
  return { el, setErrors: (e) => form.setErrors(e) };
}
