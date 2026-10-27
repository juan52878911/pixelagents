import type { Rule } from '@pixelagents/protocol';
import { clone, h, uid } from './dom.js';
import { entityPaths, formatMatchValue, formatSetValue, GROUP_SHORTCUTS, parseMatchValue, parseSetValue, previewRules, valuesAt } from './rules.js';
import { schemaForm } from './sections-basic.js';
import type { SectionView, SettingsState } from './state.js';

/** Offices and rules: groups template, kinds, zones, classify rules editor and a live preview of the draft. */
export function officesSection(st: SettingsState): SectionView {
  const entities = [...st.store.entities.values()];
  const paths = entityPaths(entities);
  const pathsId = uid('paths');
  const pathList = h('datalist', { id: pathsId }, ...paths.map((p) => h('option', { value: p })));

  // ---- groups ----
  const groups = schemaForm(st, 'groups', {
    widget: ({ path, schema, value, label, commit }) => {
      if (path.join('/') !== 'groups/by') return null;
      const id = uid('f');
      const input = h('input', { id, type: 'text', value: String(value ?? ''), spellcheck: 'false' });
      input.addEventListener('change', () => { if (input.value !== value) commit(input.value); });
      const chips = GROUP_SHORTCUTS.map((s) => h('button', {
        type: 'button', class: 'pa-btn pa-small', 'aria-pressed': String(value === s.by),
        onclick: () => { commit(s.by); st.rerender(); },
      }, s.label));
      return h('div', { class: 'pa-field', 'data-path': '/groups/by' },
        h('label', { for: id }, schema.title ?? label),
        input,
        h('div', { class: 'pa-row', role: 'group', 'aria-label': 'Shortcuts for the office template' }, ...chips),
        h('small', null, 'Template for the office id. Entities whose rules set view.group keep that one.'),
        h('div', { class: 'pa-err', 'aria-live': 'polite' }));
    },
  });

  // ---- rules ----
  let rules: Rule[] = clone(st.draft.classify);
  const list = h('div', { class: 'pa-stack' });
  const commitRules = (redraw = false): void => { st.update('classify', clone(rules)); if (redraw) drawRules(); };

  const row = (cls: string, ...kids: (Node | null)[]): HTMLElement => h('div', { class: `pa-row ${cls}` }, ...(kids.filter(Boolean) as Node[]));

  function pairRows(rule: Rule, which: 'match' | 'set', ri: number): HTMLElement {
    const box = h('div', { class: 'pa-pairs' });
    const rec = rule[which] as Record<string, unknown>;
    for (const key of Object.keys(rec)) {
      const kid = uid('f'), vid = uid('f');
      const dl = which === 'match' ? h('datalist', { id: `${vid}-v` }, ...valuesAt(entities, key).map((v) => h('option', { value: v }))) : null;
      const k = h('input', { id: kid, type: 'text', list: pathsId, value: key, 'aria-label': `Rule ${ri + 1} ${which} path`, placeholder: which === 'match' ? 'labels.account' : 'view.skin', spellcheck: 'false', class: 'pa-key' });
      const v = h('input', {
        id: vid, type: 'text', list: dl ? `${vid}-v` : null, spellcheck: 'false',
        value: which === 'match' ? formatMatchValue(rec[key] as string | string[]) : formatSetValue(rec[key]),
        'aria-label': `Rule ${ri + 1} ${which} value for ${key}`,
        placeholder: which === 'match' ? 'glob, /regex/ or a, b' : 'text, {{labels.x}} or true',
      });
      k.addEventListener('change', () => {
        const nk = k.value.trim();
        if (!nk || (nk !== key && nk in rec)) { k.value = key; return; }
        rule[which] = Object.fromEntries(Object.entries(rec).map(([a, b]) => [a === key ? nk : a, b])) as never;
        commitRules(true);
      });
      v.addEventListener('change', () => {
        rec[key] = which === 'match' ? parseMatchValue(v.value) : parseSetValue(v.value);
        commitRules();
      });
      const rm = h('button', { type: 'button', class: 'pa-btn pa-small', 'aria-label': `Remove ${which} ${key} from rule ${ri + 1}`, onclick: () => { delete rec[key]; commitRules(true); } }, '✕');
      box.append(row('pa-pair', k, h('span', { class: 'pa-eq', 'aria-hidden': 'true' }, which === 'match' ? '≈' : '='), v, rm, dl));
    }
    box.append(h('button', { type: 'button', class: 'pa-btn pa-small', onclick: () => {
      let n = ''; while ((n in rec) || n === '') n = n === '' ? (which === 'match' ? 'kind' : 'view.skin') : n + '_';
      rec[n] = which === 'match' ? '*' : ''; commitRules(true);
    } }, which === 'match' ? '+ condition' : '+ assignment'));
    return box;
  }

  function drawRules(): void {
    list.replaceChildren();
    rules.forEach((rule, i) => {
      const name = h('input', { id: uid('f'), type: 'text', value: rule.name ?? '', 'aria-label': `Rule ${i + 1} name`, placeholder: `rule ${i + 1}`, spellcheck: 'false' });
      name.addEventListener('change', () => { if (name.value) rule.name = name.value; else delete rule.name; commitRules(); });
      const move = (d: number): void => { const j = i + d; if (j < 0 || j >= rules.length) return; [rules[i], rules[j]] = [rules[j]!, rules[i]!]; commitRules(true); };
      list.append(h('fieldset', { class: 'pa-card' },
        h('legend', null, `Rule ${i + 1}`),
        row('', name,
          h('button', { type: 'button', class: 'pa-btn pa-small', 'aria-label': `Move rule ${i + 1} up`, disabled: i === 0, onclick: () => move(-1) }, '↑'),
          h('button', { type: 'button', class: 'pa-btn pa-small', 'aria-label': `Move rule ${i + 1} down`, disabled: i === rules.length - 1, onclick: () => move(1) }, '↓'),
          h('button', { type: 'button', class: 'pa-btn pa-small', 'aria-label': `Remove rule ${i + 1}`, onclick: () => { rules.splice(i, 1); commitRules(true); } }, '✕')),
        h('div', { class: 'pa-cols' },
          h('div', null, h('h4', null, 'When'), pairRows(rule, 'match', i)),
          h('div', null, h('h4', null, 'Then set'), pairRows(rule, 'set', i)))));
    });
    list.append(h('button', { type: 'button', class: 'pa-btn pa-primary', onclick: () => { rules.push({ match: { kind: '*' }, set: { 'view.skin': '' } }); commitRules(true); } }, 'Add rule'));
  }
  drawRules();

  // ---- live preview ----
  const preview = h('section', { class: 'pa-preview', 'aria-label': 'Live preview of the rules', 'aria-live': 'polite' });
  const drawPreview = (): void => {
    const live = [...st.store.entities.values()];
    const p = previewRules(live, st.draft.classify, st.draft.groups);
    preview.replaceChildren(h('h3', null, 'Preview with the current entities'));
    if (!p.total) { preview.append(h('p', { class: 'pa-help' }, 'No entities yet. The preview fills in as agents show up.')); return; }
    preview.append(h('p', null, `${p.total} entities → ${p.groups.length} offices`, p.moved.length ? `, ${p.moved.length} would change office` : ', none would change office'));
    for (const g of p.groups) {
      preview.append(h('div', { class: 'pa-pgroup', 'data-group': g.id },
        h('strong', null, g.label), h('span', { class: 'pa-tag' }, g.kind), h('span', { class: 'pa-count' }, String(g.entities.length)),
        h('div', { class: 'pa-chips' }, ...g.entities.slice(0, 12).map((id) => h('span', { class: 'pa-chip', title: id }, id.replace(/^[a-z]+:/, '').slice(0, 14))), g.entities.length > 12 ? h('span', { class: 'pa-chip' }, `+${g.entities.length - 12}`) : null)));
    }
    const skinNames = Object.keys(p.skins);
    preview.append(h('h4', null, 'Skins'), h('div', { class: 'pa-chips' }, ...skinNames.map((s) => h('span', { class: 'pa-chip', 'data-skin': s }, `${s} × ${p.skins[s]!.length}`))));
    preview.append(h('p', { class: 'pa-help' }, 'Rules contributed by plugins are not included; the current view of each entity is ignored so you see what this draft alone does.'));
  };
  drawPreview();
  const off = st.onDraft(drawPreview);
  const offStore = st.store.subscribe((c) => { if (c.type === 'snapshot' || c.type === 'delta') drawPreview(); });

  const rulesBox = h('section', { class: 'pa-stack' },
    h('h3', null, 'Classification rules'),
    h('p', { class: 'pa-help' }, 'Every matching rule applies, in order; later rules win. Conditions use globs, /regex/ or comma-separated alternatives. Assignments may use {{labels.host}} templates.'),
    pathList, list);

  const el = h('div', { class: 'pa-split' }, h('div', { class: 'pa-stack' }, groups.el, rulesBox), preview);
  groups.setErrors(st.errors);
  return { el, setErrors: (e) => groups.setErrors(e), dispose: () => { off(); offStore(); } };
}
