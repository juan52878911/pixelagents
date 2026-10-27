import type { Entity, PaEvent } from '@pixelagents/protocol';
import type { UiContext } from './types.js';
import { entityName, feedLine, fmtAgo, fmtCost, fmtDuration, fmtIntensity, fmtPct, fmtTokens, shortPath } from './format.js';
import { filterIds, type Filter } from './inspector/filter.js';
import { WaitingTracker } from './inspector/alerts.js';
import { readPref, writePref } from './inspector/prefs.js';
import { CATEGORY_LABEL, CSS, HUD_STATES, STATUS_COLOR, STATUS_LABEL } from './inspector/style.js';

/** Owner: W8. Inspector panel, HUD, feed, search/filters, waiting alerts. */
export interface InspectorOptions {
  /** Called by the HUD's settings button (main.ts opens the settings UI). */
  onOpenSettings?: () => void;
  /** Injectable clock for tests. */
  now?: () => number;
}

const FEED_MAX = 80;
const HISTORY_SHOWN = 8;
/** Metrics the curated sections already show; anything else is listed generically. */
const CURATED = new Set([
  'cost_usd', 'cost_est_usd', 'cost_turn_usd', 'context_pct', 'context_tokens', 'turns', 'tools', 'errors', 'error_streak', 'compactions', 'forks',
  'subagents_live', 'tokens_in', 'tokens_out', 'tokens_cache_read', 'tokens_cache_write', 'turn_ms', 'turn_tools', 'turn_steps', 'turn_tokens_out',
  'turn_tokens_in', 'waits', 'wait_ms_last', 'wait_ms_total', 'tools_per_min', 'intensity',
]);
const EFFORT_LABEL: Record<string, string> = { low: 'bajo', medium: 'medio', high: 'alto', xhigh: 'muy alto', max: 'máximo' };

type Attrs = Record<string, string>;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, text?: string, ...kids: (Node | null)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  for (const k of kids) if (k) n.append(k);
  return n;
}
const tid = (id: string, extra: Attrs = {}): Attrs => ({ 'data-testid': id, ...extra });

/** Mounts the HUD, search, feed and inspector panel into `ctx.root`. Returns a dispose function. */
export function mountInspector(ctx: UiContext, opts: InspectorOptions = {}): () => void {
  const { store, scene, root } = ctx;
  const now = opts.now ?? Date.now;
  const tracker = new WaitingTracker();
  const filter: Filter = { text: '', status: null };
  let selected: string | null = null;
  let following = false;
  let notify = readPref('notify', false);
  let sound = readPref('sound', false);
  const feedItems: { ev: PaEvent; text: string; ts: number }[] = [];

  const style = el('style', {}, CSS);
  const ui = el('div', { class: 'pa-ui' });
  root.append(style, ui);

  // ---- HUD ----
  const counts = el('div', tid('hud-counts', { class: 'pa-hud-counts', role: 'status', 'aria-label': 'Agentes por estado' }));
  counts.style.display = 'flex'; counts.style.gap = '12px';
  const cost = el('span', tid('hud-cost', { title: 'Gasto de hoy' }), '$0.00');
  const date = el('span', tid('hud-date'));
  const conn = el('span', tid('hud-conn', { class: 'pa-live', role: 'status' }), '');
  const chips = el('div', { class: 'pa-chips', 'aria-live': 'polite' });
  const feedOpen = readPref('feed', false);
  const feedBtn = el('button', tid('feed-toggle', { type: 'button', 'aria-pressed': String(feedOpen) }), 'Feed');
  const notifyBtn = el('button', tid('toggle-notify', { type: 'button', 'aria-pressed': String(notify), title: 'Notificación del navegador al pasar a esperar' }), 'Aviso');
  const soundBtn = el('button', tid('toggle-sound', { type: 'button', 'aria-pressed': String(sound), title: 'Sonido al pasar a esperar' }), 'Sonido');
  const settingsBtn = el('button', tid('settings', { type: 'button' }), 'Ajustes');
  const hud = el('header', { class: 'pa-hud' }, undefined, counts, chips, el('span', { class: 'pa-sp' }), cost, date, conn, notifyBtn, soundBtn, feedBtn, settingsBtn);

  // ---- search + filters ----
  const search = el('input', tid('search', { type: 'search', placeholder: 'Buscar sesión, repo, equipo, cuenta, herramienta ( / )', 'aria-label': 'Buscar agentes' }));
  const statusBtns = new Map<string, HTMLButtonElement>();
  const searchBar = el('div', { class: 'pa-search', role: 'search' }, undefined, search);
  for (const st of [...HUD_STATES, 'idle']) {
    const b = el('button', tid(`filter-${st}`, { type: 'button', 'aria-pressed': 'false' }), STATUS_LABEL[st] ?? st);
    statusBtns.set(st, b); searchBar.append(b);
  }
  const matchCount = el('span', tid('match-count', { 'aria-live': 'polite' }));
  searchBar.append(matchCount);

  // ---- feed ----
  const feedList = el('ol', { 'aria-label': 'Eventos recientes' });
  const feedFilter = el('input', tid('feed-filter', { type: 'search', placeholder: 'Filtrar feed', 'aria-label': 'Filtrar feed' }));
  const feed = el('aside', tid('feed', { class: feedOpen ? 'pa-feed' : 'pa-feed closed', 'aria-label': 'Feed de eventos' }), undefined,
    el('div', { class: 'pa-feed-head' }, 'Feed'),
    el('div', { class: 'pa-feed-body' }, undefined, feedFilter, feedList));

  // ---- panel ----
  const panel = el('section', tid('inspector', { class: 'pa-panel', 'aria-label': 'Inspector', hidden: '' }));

  ui.append(hud, searchBar, feed, panel);

  // ---- rendering ----
  function renderHud(): void {
    const c: Record<string, number> = {};
    let usd = 0;
    for (const e of store.entities.values()) {
      if (e.kind === 'host' || e.status === 'ended') continue;
      c[e.status] = (c[e.status] ?? 0) + 1;
      usd += e.metrics.cost_usd ?? 0;
    }
    counts.replaceChildren(...HUD_STATES.map((s) => {
      const n = c[s] ?? 0;
      const item = el('span', tid(`count-${s}`, { class: 'pa-count' }), undefined,
        el('i', { class: 'pa-dot', style: `background:${STATUS_COLOR[s]}` }), el('span', {}, `${n} ${STATUS_LABEL[s]}`));
      return item;
    }));
    cost.textContent = fmtCost(usd);
    date.textContent = new Date(now()).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
    const live = store.status === 'open' || store.status === 'idle';
    conn.textContent = live ? 'en vivo' : 'reconectando';
    conn.classList.toggle('off', !live);
  }

  let chipSig = '\0';
  function renderChips(): void {
    const sig = [...tracker.waiting.keys()].join('|');
    if (sig === chipSig) return;
    chipSig = sig;
    chips.replaceChildren(...[...tracker.waiting.keys()].map((id) => {
      const e = store.entities.get(id);
      const b = el('button', tid('waiting-chip', { type: 'button', class: 'pa-chip', 'data-entity': id }), `⏳ ${e ? entityName(e) : id}`);
      b.addEventListener('click', () => { scene.focus(id); select(id); });
      return b;
    }));
  }

  function renderFeed(): void {
    const q = feedFilter.value.trim().toLowerCase();
    const rows = feedItems.filter((f) => !q || f.text.toLowerCase().includes(q));
    feedList.replaceChildren(...rows.map((f) => {
      const b = el('button', { type: 'button', title: f.text }, undefined,
        el('time', {}, new Date(f.ts).toLocaleTimeString('es', { hour12: false })), document.createTextNode(f.text));
      b.addEventListener('click', () => { scene.focus(f.ev.entity); select(f.ev.entity); });
      return el('li', {}, undefined, b);
    }));
  }

  function row(dl: HTMLElement, k: string, v: string | undefined, attrs: Attrs = {}): void {
    if (!v) return;
    dl.append(el('dt', {}, k), el('dd', attrs, v));
  }

  function renderPanel(): void {
    const e = selected ? store.entities.get(selected) : undefined;
    if (!e) { panel.hidden = true; panel.replaceChildren(); return; }
    panel.hidden = false;
    const l = e.labels;
    const act = e.activity;
    const color = STATUS_COLOR[e.status] ?? '#8f96a3';
    const kids: Node[] = [];

    const close = el('button', tid('inspector-close', { type: 'button', 'aria-label': 'Cerrar inspector' }), '×');
    close.addEventListener('click', () => select(null));
    kids.push(el('h2', {}, undefined, el('span', tid('inspector-name'), entityName(e)), close));
    kids.push(el('span', tid('inspector-status', { class: 'pa-status', style: `background:${color}` }), STATUS_LABEL[e.status] ?? e.status));

    const actBox = el('div', { class: 'pa-act' });
    if (act) {
      actBox.append(
        el('div', { class: 'tool' }, undefined, el('span', tid('inspector-tool'), act.tool ?? '—')),
        el('span', tid('inspector-detail', { class: 'detail' }), act.detail ?? ''),
        el('div', {}, undefined,
          el('span', tid('inspector-category'), CATEGORY_LABEL[act.category ?? 'other'] ?? act.category ?? ''),
          document.createTextNode(' · lleva '), el('span', tid('inspector-elapsed'), fmtDuration(now() - Date.parse(act.since)))),
      );
    } else {
      actBox.append(el('span', tid('inspector-tool'), '—'), el('span', tid('inspector-detail', { class: 'detail' })));
    }
    kids.push(actBox);

    const dl = el('dl');
    row(dl, 'sesión', e.id);
    row(dl, 'cuenta', l.account); row(dl, 'equipo', l.team); row(dl, 'host', l.host);
    row(dl, 'repo', l.repo); row(dl, 'rama', l.branch); row(dl, 'modelo', l.model);
    row(dl, 'tipo', l.agent_type); row(dl, 'permisos', l.permission_mode);
    if (e.status === 'waiting' && act) row(dl, 'esperando', fmtDuration(now() - Date.parse(act.since)), tid('inspector-waiting'));
    row(dl, 'visto', fmtAgo(e.lastSeen, now()));
    kids.push(dl);

    const m = e.metrics;
    // ---- turn in progress / last turn ----
    const t = e.turn;
    if (t) {
      const open = !t.until;
      kids.push(el('h3', {}, open ? `Turno ${t.n || ''} en curso`.replace('  ', ' ') : `Último turno${t.n ? ` (${t.n})` : ''}`));
      const td = el('dl');
      const turnMs = open ? now() - Date.parse(t.since) : m.turn_ms ?? Date.parse(t.until!) - Date.parse(t.since);
      row(td, 'duración', fmtDuration(turnMs), tid('inspector-turn-elapsed'));
      const parts = [`${t.tools} herr.`];
      if (t.errors) parts.push(`${t.errors} err.`);
      if (t.forks) parts.push(`${t.forks} subag.`);
      if (!open && m.turn_steps) parts.push(`${m.turn_steps} pasos`);
      row(td, 'actividad', parts.join(' · '), tid('inspector-turn-tools'));
      if (!open && m.turn_tokens_out !== undefined) row(td, 'tokens', `${fmtTokens(m.turn_tokens_in)} → ${fmtTokens(m.turn_tokens_out)}`);
      if (!open && m.cost_turn_usd !== undefined) row(td, 'coste', `≈ ${fmtCost(m.cost_turn_usd)}`);
      kids.push(td);
    }

    // ---- effort ----
    const ed = el('dl');
    if (m.intensity !== undefined || l.effort) {
      kids.push(el('h3', {}, 'Esfuerzo'));
      if (m.intensity !== undefined) {
        row(ed, 'intensidad', fmtIntensity(m.intensity), tid('inspector-intensity'));
        if (m.tools_per_min) row(ed, 'ritmo', `${Math.round(m.tools_per_min * 10) / 10} herr./min`);
      }
      if (l.effort) row(ed, 'nivel', EFFORT_LABEL[l.effort] ?? l.effort);
      kids.push(ed);
    }

    // ---- session totals ----
    kids.push(el('h3', {}, 'Sesión'));
    const md = el('dl');
    const cost = m.cost_usd ?? m.cost_est_usd;
    if (cost !== undefined) row(md, 'coste', `${m.cost_usd === undefined ? '≈ ' : ''}${fmtCost(cost)}`, tid('inspector-cost'));
    if (m.tokens_out !== undefined || m.tokens_in !== undefined) {
      row(md, 'tokens', `${fmtTokens((m.tokens_in ?? 0) + (m.tokens_cache_read ?? 0) + (m.tokens_cache_write ?? 0))} → ${fmtTokens(m.tokens_out)}`, tid('inspector-tokens'));
      if (m.tokens_cache_read) row(md, 'caché', `${fmtTokens(m.tokens_cache_read)} leídos`);
    }
    if (m.context_tokens !== undefined) row(md, 'contexto', `${fmtTokens(m.context_tokens)} tok`);
    if (m.context_pct !== undefined) {
      row(md, 'contexto', fmtPct(m.context_pct));
      md.append(el('dt', {}, ''), el('dd', {}, undefined, el('div', { class: 'pa-bar' }, undefined, el('i', { style: `width:${Math.min(100, m.context_pct)}%` }))));
    }
    const totals = [];
    if (m.turns) totals.push(`${m.turns} turnos`);
    if (m.tools) totals.push(`${m.tools} herr.`);
    if (m.errors) totals.push(`${m.errors} err.${m.error_streak && m.error_streak > 1 ? ` (${m.error_streak} seguidos)` : ''}`);
    if (m.compactions) totals.push(`${m.compactions} compact.`);
    if (totals.length) row(md, 'totales', totals.join(' · '), tid('inspector-totals'));
    if (m.waits) row(md, 'esperas', `${m.waits}${m.wait_ms_total ? ` · ${fmtDuration(m.wait_ms_total)}` : ''}`);
    for (const [k, v] of Object.entries(m)) {
      if (CURATED.has(k)) continue;
      row(md, k.replace(/_/g, ' '), /pct$/.test(k) ? fmtPct(v) : String(Math.round(v * 100) / 100));
    }
    kids.push(md);

    // ---- relations: parent, subagents, repo mates ----
    const subs = [...store.entities.values()].filter((x) => x.parent === e.id);
    const parent = e.parent ? store.entities.get(e.parent) : undefined;
    const live = subs.filter((x) => x.status !== 'ended').length;
    if (subs.length || parent) {
      kids.push(el('h3', {}, parent ? 'Relacionados' : `Subagentes · ${live} vivos${m.forks ? ` · ${m.forks} lanzados` : ''}`));
      const ul = el('ul');
      for (const x of parent ? [parent, ...subs] : subs) {
        const tag = x === parent ? '↑ ' : x.status === 'ended' ? '✓ ' : '· ';
        const b = el('button', tid('inspector-sub', { type: 'button', class: 'pa-link' }), `${tag}${x.labels.agent_type ? `${x.labels.agent_type} ` : ''}${entityName(x)} · ${STATUS_LABEL[x.status] ?? x.status}`);
        b.addEventListener('click', () => { scene.focus(x.id); select(x.id); });
        ul.append(el('li', {}, undefined, b));
      }
      kids.push(ul);
    }
    const mates = l.repo ? [...store.entities.values()].filter((x) => x.id !== e.id && x.kind !== 'subagent' && !x.view?.hidden && x.labels.repo === l.repo && x.status !== 'ended') : [];
    if (mates.length) {
      kids.push(el('h3', {}, `Mismo repo · ${mates.length}`));
      const ul = el('ul');
      for (const x of mates) {
        const b = el('button', tid('inspector-mate', { type: 'button', class: 'pa-link' }), `${entityName(x)} · ${STATUS_LABEL[x.status] ?? x.status}${x.labels.branch && x.labels.branch !== l.branch ? ` · ${x.labels.branch}` : ''}`);
        b.addEventListener('click', () => { scene.focus(x.id); select(x.id); });
        ul.append(el('li', {}, undefined, b));
      }
      kids.push(ul);
    }

    kids.push(el('h3', {}, 'Historial'));
    const hist = el('ul', tid('inspector-history'));
    for (const h of e.history.slice(-HISTORY_SHOWN).reverse()) {
      hist.append(el('li', {}, undefined, el('time', {}, fmtAgo(h.ts, now())), document.createTextNode(shortPath(h.summary, l.repo, 60))));
    }
    kids.push(hist);

    const follow = el('button', tid('follow', { type: 'button', 'aria-pressed': String(following) }), following ? 'Siguiendo (f)' : 'Seguir (f)');
    follow.addEventListener('click', toggleFollow);
    follow.style.marginTop = '10px';
    kids.push(follow);
    panel.replaceChildren(...kids);
  }

  /** Cheap per-second refresh of the elapsed/relative times without rebuilding focus-holding nodes. */
  function tick(): void {
    renderHud();
    const e = selected ? store.entities.get(selected) : undefined;
    if (e) {
      const el1 = panel.querySelector('[data-testid=inspector-elapsed]');
      if (el1 && e.activity) el1.textContent = fmtDuration(now() - Date.parse(e.activity.since));
      const el2 = panel.querySelector('[data-testid=inspector-turn-elapsed]');
      if (el2 && e.turn && !e.turn.until) el2.textContent = fmtDuration(now() - Date.parse(e.turn.since));
      const el3 = panel.querySelector('[data-testid=inspector-waiting]');
      if (el3 && e.activity && e.status === 'waiting') el3.textContent = fmtDuration(now() - Date.parse(e.activity.since));
    }
    if (following && selected) scene.focus(selected);
  }

  // ---- actions ----
  function select(id: string | null): void {
    if (id !== selected) following = false;
    selected = id;
    renderPanel();
  }
  function toggleFollow(): void {
    if (!selected) return;
    following = !following;
    if (following) scene.focus(selected);
    renderPanel();
  }
  function applyFilter(): void {
    filter.text = search.value;
    const ids = filterIds(store.entities.values(), filter);
    scene.highlight(ids);
    matchCount.textContent = ids ? `${ids.length} coinciden` : '';
  }

  search.addEventListener('input', applyFilter);
  for (const [st, b] of statusBtns) {
    b.addEventListener('click', () => {
      filter.status = filter.status === st ? null : st;
      for (const [s2, b2] of statusBtns) b2.setAttribute('aria-pressed', String(s2 === filter.status));
      applyFilter();
    });
  }
  feedFilter.addEventListener('input', renderFeed);
  feedBtn.addEventListener('click', () => {
    const closed = feed.classList.toggle('closed');
    feedBtn.setAttribute('aria-pressed', String(!closed));
    writePref('feed', !closed);
  });
  settingsBtn.addEventListener('click', () => opts.onOpenSettings?.());
  notifyBtn.addEventListener('click', () => {
    notify = !notify; writePref('notify', notify);
    notifyBtn.setAttribute('aria-pressed', String(notify));
    if (notify && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
  });
  soundBtn.addEventListener('click', () => {
    sound = !sound; writePref('sound', sound);
    soundBtn.setAttribute('aria-pressed', String(sound));
    if (sound) beep();
  });

  let audio: AudioContext | null = null;
  function beep(): void {
    try {
      audio ??= new AudioContext();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = 660; g.gain.value = 0.05;
      o.connect(g).connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.12);
    } catch { /* no audio available */ }
  }

  function alertWaiting(es: Entity[]): void {
    for (const e of es) {
      if (notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try { new Notification(`${entityName(e)} está esperando`, { body: [e.labels.repo, e.activity?.tool].filter(Boolean).join(' · ') }); } catch { /* ignore */ }
      }
    }
    if (es.length && sound) beep();
  }

  function onKey(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (ev.key === 'Escape') {
      if (typing) { (t as HTMLInputElement).blur(); return; }
      if (search.value || filter.status) {
        search.value = ''; filter.status = null;
        for (const b of statusBtns.values()) b.setAttribute('aria-pressed', 'false');
        applyFilter();
      } else select(null);
      return;
    }
    if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === '/') { ev.preventDefault(); search.focus(); }
    else if (ev.key === 'f') toggleFollow();
  }
  document.addEventListener('keydown', onKey);

  // ---- wiring ----
  scene.onSelect((id) => select(id));

  const unsub = store.subscribe((c) => {
    if (c.type === 'snapshot') {
      tracker.reset(store.entities.values(), now());
      renderChips(); renderHud(); renderPanel();
      if (filter.text || filter.status) applyFilter();
    } else if (c.type === 'delta') {
      const fresh = tracker.update(c.upsert, c.remove, now());
      renderChips();
      if (fresh.length) alertWaiting(fresh);
      for (const ev of c.events) {
        const ent = store.entities.get(ev.entity);
        if (ent?.kind === 'host') continue;
        feedItems.unshift({ ev, text: feedLine(ev, ent), ts: Date.parse(ev.ts) || now() });
      }
      if (feedItems.length > FEED_MAX) feedItems.length = FEED_MAX;
      if (c.events.length) renderFeed();
      if (selected && (c.upsert.some((e) => e.id === selected) || c.remove.includes(selected) || c.upsert.some((e) => e.parent === selected))) {
        if (c.remove.includes(selected)) select(null); else renderPanel();
      }
      if (filter.text || filter.status) applyFilter();
      renderHud();
    } else if (c.type === 'status') renderHud();
  });

  tracker.reset(store.entities.values(), now());
  renderHud(); renderChips();
  const timer = setInterval(tick, 1000);

  return () => {
    clearInterval(timer); unsub();
    document.removeEventListener('keydown', onKey);
    style.remove(); ui.remove();
  };
}

