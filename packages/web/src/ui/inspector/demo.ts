import type { ActivityCategory, Entity, PaEvent } from '@pixelagents/protocol';
import { Store } from '../../store.js';
import type { SceneApi } from '../types.js';
import { mountInspector } from '../inspector.js';

/** Test page: demo store with realistic labels plus a fake SceneApi (a grid of clickable squares). */
const stage = document.getElementById('stage')!;
const store = new Store();
const REPOS = ['web-app', 'api', 'infra', 'docs'];
const TEAMS = ['core', 'growth'];
const TOOLS: [string, string, ActivityCategory][] = [
  ['Edit', '/home/dev/web-app/src/app.ts', 'edit'], ['Read', '/home/dev/api/src/routes/users.ts', 'read'],
  ['Bash', 'npm test -- --watch=false', 'run'], ['Grep', 'TODO in src/', 'read'], ['WebFetch', 'https://example.com/docs', 'web'],
];
const STATUSES = ['working', 'thinking', 'waiting', 'idle', 'sleeping'];
const iso = (t = Date.now()) => new Date(t).toISOString();

const ents: Entity[] = Array.from({ length: 10 }, (_, i) => {
  const [tool, detail, category] = TOOLS[i % TOOLS.length]!;
  const repo = REPOS[i % REPOS.length]!;
  return {
    id: `agent:s${i}`, kind: 'agent',
    labels: { host: i % 2 ? 'laptop' : 'desktop', repo, team: TEAMS[i % 2]!, account: i % 3 ? 'personal' : 'work', branch: `feat/x${i}`, model: 'claude-sonnet' },
    status: STATUSES[i % STATUSES.length]!,
    activity: { tool, detail: detail.replace('web-app', repo), category, since: iso(Date.now() - (i + 1) * 37_000) },
    metrics: { cost_usd: 0.12 * (i + 1), context_pct: 10 + i * 8 },
    firstSeen: iso(), lastSeen: iso(),
    history: [{ ts: iso(Date.now() - 60_000), kind: 'tool.pre', summary: `${tool} ${detail}` }, { ts: iso(Date.now() - 20_000), kind: 'tool.post', summary: 'ok' }],
    view: { group: 'o' },
  };
});
ents.push({ id: 'agent:sub1', kind: 'subagent', parent: 'agent:s0', labels: { ...ents[0]!.labels }, status: 'working', metrics: { cost_usd: 0.02 }, firstSeen: iso(), lastSeen: iso(), history: [], view: {}, activity: { tool: 'Read', detail: '/home/dev/web-app/README.md', category: 'read', since: iso() } });
store.applySnapshot({ protocol: 1, seq: 0, entities: ents, groups: [] });

// fake scene
const dots = new Map<string, HTMLElement>();
const stageGrid = document.createElement('div');
stageGrid.style.cssText = 'position:absolute;left:340px;top:140px;display:grid;grid-template-columns:repeat(6,40px);gap:10px';
stage.append(stageGrid);
for (const e of ents) {
  const d = document.createElement('div');
  d.dataset.entity = e.id; d.style.cssText = 'width:40px;height:40px;background:#3b3346;cursor:pointer';
  stageGrid.append(d); dots.set(e.id, d);
}
let onSel: ((id: string | null) => void) | null = null;
const calls: { focus: string[]; highlight: (string[] | null)[] } = { focus: [], highlight: [] };
(window as unknown as { __scene: unknown }).__scene = calls;
const scene: SceneApi = {
  onSelect: (cb) => { onSel = cb; },
  focus: (id) => { calls.focus.push(id); for (const [k, d] of dots) d.style.outline = k === id ? '3px solid #ffd23f' : ''; },
  highlight: (ids) => { calls.highlight.push(ids); for (const [k, d] of dots) d.style.opacity = !ids || ids.includes(k) ? '1' : '.2'; },
  screenPos: (id) => { const r = dots.get(id)?.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null; },
};
for (const [id, d] of dots) d.addEventListener('click', () => onSel?.(id));

mountInspector({ store, scene, root: stage }, { onOpenSettings: () => { stage.dataset.settings = 'open'; } });

// activity: every 2 s change a couple of agents and emit events
let seq = 0, n = 0;
if (!location.search.includes('still')) setInterval(() => {
  const upsert: Entity[] = [], events: PaEvent[] = [];
  for (let k = 0; k < 2; k++) {
    const e = ents[(n * 3 + k * 5) % 10]!;
    const [tool, detail, category] = TOOLS[(n + k) % TOOLS.length]!;
    e.status = STATUSES[(n + k) % 3]!;
    e.lastSeen = iso();
    e.activity = { tool, detail: detail.replace('web-app', e.labels.repo!), category, since: e.lastSeen };
    upsert.push({ ...e });
    events.push({ ts: e.lastSeen, source: 'demo', entity: e.id, kind: 'tool.pre', attrs: { tool, detail: e.activity.detail } });
  }
  n++;
  store.applyDelta({ seq: ++seq, upsert, events });
}, 2000);
(window as unknown as { __store: Store }).__store = store;
