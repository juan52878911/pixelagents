import { CHARACTER_KEYS } from '@pixelagents/protocol';
import type { SkinConfig } from '@pixelagents/protocol';
import { clone, h, uid } from './dom.js';
import { schemaForm } from './sections-basic.js';
import type { SectionView, SettingsState } from './state.js';

const KNOWN_FILTERS = ['crt', 'daynight', 'glow'];
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** Radio-like grid of sprite thumbnails with a "none" choice. */
function spritePicker(st: SettingsState, label: string, names: string[], value: string | undefined, onPick: (v: string | undefined) => void): HTMLElement {
  const group = h('div', { class: 'pa-picker', role: 'radiogroup', 'aria-label': label });
  const make = (name: string | undefined): HTMLElement => {
    const on = (value ?? undefined) === name;
    const btn = h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(on), class: 'pa-pick' + (on ? ' pa-on' : ''), title: name ?? 'none',
      onclick: () => onPick(name),
    }, name ? st.catalog.thumb(name, 32) : h('span', { class: 'pa-none', 'aria-hidden': 'true' }, '∅'), h('span', null, name ?? 'none'));
    return btn;
  };
  group.append(make(undefined), ...names.map(make));
  if (value && !names.includes(value)) group.append(h('span', { class: 'pa-help' }, `"${value}" is not among the loaded sprites.`));
  return group;
}

function colorRow(label: string, key: string, value: string | undefined, onChange: (v: string | undefined) => void): HTMLElement {
  const cid = uid('f'), tid = uid('f');
  const picker = h('input', { id: cid, type: 'color', value: value && HEX6.test(value) ? value : '#808080', disabled: value === undefined, 'aria-label': `${label} (${key}) color` });
  const text = h('input', { id: tid, type: 'text', value: value ?? '', class: 'pa-hex', 'aria-label': `${label} (${key}) value`, placeholder: 'default', spellcheck: 'false' });
  picker.addEventListener('input', () => { text.value = picker.value; });
  picker.addEventListener('change', () => onChange(picker.value));
  text.addEventListener('change', () => onChange(text.value.trim() === '' ? undefined : text.value.trim()));
  return h('div', { class: 'pa-color' }, h('span', { class: 'pa-ckey' }, `${key}`), h('label', { for: tid }, label), picker, text);
}

function skinsEditor(st: SettingsState): HTMLElement {
  let skins: Record<string, SkinConfig> = clone(st.draft.skins);
  const root = h('div', { class: 'pa-stack' });
  const commit = (redraw = false): void => { st.update('skins', clone(skins)); if (redraw) draw(); };
  const accessories = st.catalog.names('acc.');
  const items = st.catalog.names('item.');

  function skinCard(name: string): HTMLElement {
    const skin = (skins[name] ??= {});
    const pal = (skin.palette ??= {});
    const extraKeys = Object.keys(pal).filter((k) => !(k in CHARACTER_KEYS));
    const colors = h('div', { class: 'pa-colors' });
    for (const [k, desc] of Object.entries(CHARACTER_KEYS)) {
      colors.append(colorRow(desc, k, pal[k], (v) => { if (v === undefined) delete pal[k]; else pal[k] = v; commit(true); }));
    }
    for (const k of extraKeys) colors.append(colorRow('custom', k, pal[k], (v) => { if (v === undefined) delete pal[k]; else pal[k] = v; commit(true); }));
    const nameInput = h('input', { id: uid('f'), type: 'text', value: name, 'aria-label': `Skin name (${name})`, spellcheck: 'false' });
    nameInput.addEventListener('change', () => {
      const nn = nameInput.value.trim();
      if (!nn || nn === name || nn in skins) { nameInput.value = name; return; }
      skins = Object.fromEntries(Object.entries(skins).map(([k, v]) => [k === name ? nn : k, v]));
      commit(true);
    });
    const tidy = (): void => { if (!Object.keys(pal).length) delete skin.palette; };
    return h('fieldset', { class: 'pa-card', 'data-skin': name },
      h('legend', null, `Skin ${name}`),
      h('div', { class: 'pa-row' }, h('label', { for: nameInput.id }, 'Name'), nameInput,
        h('button', { type: 'button', class: 'pa-btn pa-small', 'aria-label': `Remove skin ${name}`, onclick: () => { delete skins[name]; commit(true); } }, '✕')),
      h('h4', null, 'Palette'),
      h('p', { class: 'pa-help' }, 'Only the colors you set override the base character; the others keep their default.'),
      (() => { const w = h('div'); w.append(colors); w.addEventListener('change', tidy); return w; })(),
      h('h4', null, 'Accessory'),
      spritePicker(st, `Accessory of ${name}`, accessories, skin.accessory, (v) => { if (v) skin.accessory = v; else delete skin.accessory; commit(true); }),
      h('h4', null, 'Carried item'),
      spritePicker(st, `Item of ${name}`, items, skin.item, (v) => { if (v) skin.item = v; else delete skin.item; commit(true); }));
  }

  function draw(): void {
    root.replaceChildren(...Object.keys(skins).map(skinCard));
    const nn = h('input', { id: uid('f'), type: 'text', 'aria-label': 'New skin name', placeholder: 'new skin name', spellcheck: 'false' });
    root.append(h('div', { class: 'pa-row' }, nn, h('button', { type: 'button', class: 'pa-btn pa-primary', onclick: () => {
      const n = nn.value.trim(); if (!n || n in skins) return; skins[n] = { palette: {} }; commit(true);
    } }, 'Add skin')));
  }
  draw();
  return root;
}

/** Appearance: skins, behaviors per status, world, effects per layer, fun. */
export function lookSection(st: SettingsState): SectionView {
  const filters = [...new Set([...KNOWN_FILTERS, ...st.draft.effects.map((e) => e.filter)])];
  const fid = uid('filters');
  const forms = {
    behaviors: schemaForm(st, 'behaviors'),
    world: schemaForm(st, 'world'),
    effects: schemaForm(st, 'effects', {
      widget: ({ path, schema, value, label, commit }) => {
        if (path[0] !== 'effects' || path[path.length - 1] !== 'filter') return null;
        const id = uid('f');
        const input = h('input', { id, type: 'text', list: fid, value: String(value ?? ''), spellcheck: 'false' });
        input.addEventListener('change', () => { if (input.value !== value) commit(input.value); });
        return h('div', { class: 'pa-field', 'data-path': '/' + path.join('/') }, h('label', { for: id }, schema.title ?? label), input, h('div', { class: 'pa-err', 'aria-live': 'polite' }));
      },
    }),
    fun: schemaForm(st, 'fun'),
  };
  const sec = (title: string, ...kids: Node[]): HTMLElement => h('details', { class: 'pa-details', open: true }, h('summary', null, title), ...kids);
  const el = h('div', { class: 'pa-stack' },
    sec('Skins', skinsEditor(st)),
    sec('Behaviors by status', h('p', { class: 'pa-help' }, 'Status → behavior name. "*" is the fallback. "minion" is used for subagents by default.'), forms.behaviors.el),
    sec('World', forms.world.el),
    sec('Effects by layer', h('p', { class: 'pa-help' }, 'Layers: world, actors, ui, screen. Filters come from the engine or plugins.'), h('datalist', { id: fid }, ...filters.map((f) => h('option', { value: f }))), forms.effects.el),
    sec('Fun', forms.fun.el));
  const setErrors = (e: { path: string; message: string }[]): void => { for (const f of Object.values(forms)) f.setErrors(e); };
  setErrors(st.errors);
  return { el, setErrors };
}
