import type { PaConfig } from '@pixelagents/protocol';
import type { UiContext } from './types.js';
import { advancedSection } from './settings/advanced.js';
import { Api } from './settings/api.js';
import { Catalog } from './settings/catalog.js';
import { clone, deepEqual, h } from './settings/dom.js';
import type { FormError } from './settings/form.js';
import { lookSection } from './settings/look.js';
import { officesSection } from './settings/offices.js';
import { multiForm, sourcesSection } from './settings/sections-basic.js';
import type { SectionBuilder, SectionView, SettingsState } from './settings/state.js';
import { spritesSection } from './settings/sprites.js';
import { injectStyles } from './settings/styles.js';

/** Owner: W9. Settings UI generated from /api/schema, PUT /api/config, rules preview, asset upload. */
export type SectionId = 'sources' | 'offices' | 'look' | 'sprites' | 'advanced';
export interface SettingsHandle {
  open(section?: SectionId): void;
  close(): void;
}
export interface SettingsOptions {
  /** Server origin when the UI is not served by it (default: same origin). */
  base?: string;
  token?: string | null;
}

const SECTIONS: { id: SectionId; title: string; build: SectionBuilder }[] = [
  { id: 'sources', title: 'Sources', build: sourcesSection },
  { id: 'offices', title: 'Offices & rules', build: officesSection },
  { id: 'look', title: 'Appearance', build: lookSection },
  { id: 'sprites', title: 'Sprites', build: spritesSection },
  {
    id: 'advanced', title: 'Advanced',
    build: (st) => {
      const general = multiForm(st, ['server', 'timing', 'plugins', 'assets', 'pluginConfig']);
      const json = advancedSection(st);
      const el = h('div', { class: 'pa-stack' }, h('h3', null, 'General'), general.el, h('h3', null, 'Whole configuration'), json.el);
      return { el, setErrors: (e) => { general.setErrors?.(e); json.setErrors?.(e); } };
    },
  },
];

export function mountSettings(ctx: UiContext, opts: SettingsOptions = {}): SettingsHandle {
  injectStyles();
  const token = opts.token ?? new URLSearchParams(location.search).get('token');
  const api = new Api(opts.base ?? '', token);
  const catalog = new Catalog();

  let current: SectionId = 'sources';
  let view: SectionView | null = null;
  let loaded: Promise<void> | null = null;
  let loadError = '';
  const listeners = new Set<() => void>();

  const st = {
    api, store: ctx.store, catalog, plugins: [], assets: [], errors: [] as FormError[],
    schema: null as unknown, baseline: null as unknown, draft: null as unknown,
    update(key: keyof PaConfig, value: unknown) { st.draft = { ...(st.draft as PaConfig), [key]: value }; changed(); },
    replace(cfg: PaConfig) { st.draft = cfg; changed(); },
    onDraft(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); },
    async refreshAssets() {
      st.assets = await api.getAssets().catch(() => st.assets);
      await catalog.load(api, st.assets);
    },
    toast(msg: string, kind: 'ok' | 'error' = 'ok') { toast.textContent = msg; toast.className = `pa-toast ${kind}`; },
    rerender() { render(); },
  } as unknown as SettingsState;

  // ---- DOM ----
  const nav = h('nav', { class: 'pa-nav', 'aria-label': 'Settings sections' });
  const main = h('div', { class: 'pa-main', id: 'pa-main', tabindex: -1 });
  const toast = h('span', { class: 'pa-toast', role: 'status', 'aria-live': 'polite' });
  const dirtyMark = h('span', { class: 'pa-dirty' });
  const saveBtn = h('button', { type: 'button', class: 'pa-btn pa-primary', id: 'pa-save', onclick: () => void save() }, 'Save');
  const revertBtn = h('button', { type: 'button', class: 'pa-btn', id: 'pa-revert', onclick: () => { st.draft = clone(st.baseline); st.errors = []; changed(); render(); st.toast('Changes discarded'); } }, 'Revert');
  const reloadBtn = h('button', { type: 'button', class: 'pa-btn', id: 'pa-reload', onclick: () => void reloadFromServer() }, 'Reload from server');
  const overwriteBtn = h('button', { type: 'button', class: 'pa-btn pa-primary', id: 'pa-overwrite', onclick: () => void overwrite() }, 'Keep mine and save');
  const banner = h('div', { class: 'pa-banner', role: 'alert', hidden: true },
    h('span', null, 'The configuration changed on the server while you were editing.'), reloadBtn, overwriteBtn);
  const errBox = h('div', { class: 'pa-err', id: 'pa-errors', role: 'alert' });
  const panel = h('aside', { class: 'pa-settings', role: 'dialog', 'aria-label': 'pixelagents settings', id: 'pa-settings' },
    h('header', null, h('h2', null, 'Settings'),
      h('button', { type: 'button', class: 'pa-btn', id: 'pa-close', 'aria-label': 'Close settings', onclick: () => close() }, '✕')),
    banner,
    h('div', { class: 'pa-body' }, nav, main),
    h('footer', { class: 'pa-foot' }, saveBtn, revertBtn, dirtyMark, toast, h('span', { class: 'pa-grow' }), errBox));
  ctx.root.append(panel);

  for (const s of SECTIONS) {
    nav.append(h('button', { type: 'button', 'data-section': s.id, onclick: () => { current = s.id; errBoxClear(); render(); } }, s.title));
  }
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.pa-grid')) close(); });

  // ---- state ----
  const dirty = (): boolean => !!st.baseline && !deepEqual(st.draft, st.baseline);
  function changed(): void {
    st.errors = [];
    dirtyMark.textContent = dirty() ? '● unsaved changes' : '';
    revertBtn.disabled = !dirty();
    if (dirty()) toast.textContent = '';
    for (const l of listeners) l();
  }
  function errBoxClear(): void { errBox.textContent = ''; }

  function render(): void {
    view?.dispose?.();
    for (const b of nav.children) b.setAttribute('aria-current', (b as HTMLElement).dataset.section === current ? 'page' : 'false');
    for (const b of nav.children) if ((b as HTMLElement).dataset.section !== current) b.removeAttribute('aria-current');
    listeners.clear();
    main.replaceChildren();
    if (loadError) { main.append(h('p', { class: 'pa-err' }, loadError), h('button', { type: 'button', class: 'pa-btn', onclick: () => { loaded = null; void ensureLoaded().then(render); } }, 'Retry')); return; }
    if (!st.draft) { main.append(h('p', null, 'Loading…')); return; }
    const sec = SECTIONS.find((s) => s.id === current)!;
    main.append(h('h2', { class: 'pa-title' }, sec.title));
    view = sec.build(st);
    main.append(view.el);
    if (st.errors.length) view.setErrors?.(st.errors);
  }

  async function ensureLoaded(): Promise<void> {
    loaded ??= (async () => {
      try {
        loadError = '';
        const [cfg, schema, plugins, assets] = await Promise.all([api.getConfig(), api.getSchema(), api.getPlugins().catch(() => []), api.getAssets().catch(() => [])]);
        st.schema = schema; st.plugins = plugins; st.assets = assets;
        st.baseline = clone(cfg); st.draft = clone(cfg);
        await catalog.load(api, assets);
        changed();
      } catch (e) {
        loadError = `Could not load the configuration: ${(e as Error).message}`;
      }
    })();
    return loaded;
  }

  async function save(): Promise<void> {
    errBoxClear();
    const r = await api.putConfig(st.draft);
    if (r.ok) {
      st.baseline = clone(st.draft);
      banner.hidden = true;
      changed();
      st.toast(r.restartRequired.length ? `Saved. Restart needed for: ${r.restartRequired.join(', ')}` : r.warnings.length ? `Saved with warnings: ${r.warnings.join('; ')}` : 'Saved and applied', 'ok');
      return;
    }
    st.errors = r.errors;
    errBox.textContent = `${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}: ${r.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join(' · ')}`;
    st.toast('Not saved', 'error');
    view?.setErrors?.(r.errors);
  }

  async function reloadFromServer(): Promise<void> {
    const cfg = await api.getConfig();
    st.baseline = clone(cfg); st.draft = clone(cfg);
    banner.hidden = true;
    changed(); render();
    st.toast('Reloaded the server configuration');
  }
  async function overwrite(): Promise<void> {
    banner.hidden = true;
    await save();
  }

  // Changes pushed by the server (another tab, a file edit, our own save echoing back).
  let checking = false;
  ctx.store.subscribe((c) => {
    if (c.type === 'config' && st.baseline && !checking) {
      checking = true;
      void api.getConfig().then((remote) => {
        if (deepEqual(remote, st.baseline)) return;
        if (!dirty()) { st.baseline = clone(remote); st.draft = clone(remote); changed(); if (panel.classList.contains('pa-open')) render(); st.toast('Configuration updated from the server'); }
        else { st.baseline = clone(remote); banner.hidden = false; changed(); }
      }).catch(() => {}).finally(() => { checking = false; });
    } else if (c.type === 'assets' && st.baseline) {
      void st.refreshAssets().then(() => { if (current === 'sprites' && panel.classList.contains('pa-open') && !main.querySelector('.pa-editor:not(:empty)')) render(); });
    }
  });

  function open(section?: SectionId): void {
    if (section) current = section;
    panel.classList.add('pa-open');
    render();
    void ensureLoaded().then(render);
    (panel.querySelector('#pa-close') as HTMLElement | null)?.focus();
  }
  function close(): void { panel.classList.remove('pa-open'); }

  return { open, close };
}
