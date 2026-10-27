import type { Activity, ActivityCategory, Entity, PaEvent, TokenUsage } from '@pixelagents/protocol';

const CATEGORY: Record<string, ActivityCategory> = {
  Read: 'read', Grep: 'read', Glob: 'read', LS: 'read',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  Bash: 'run',
  WebFetch: 'web', WebSearch: 'web',
  Task: 'talk', Agent: 'talk',
};

export function categoryOf(tool: string | undefined): ActivityCategory {
  return (tool && CATEGORY[tool]) || 'other';
}

function str(v: unknown, max = 120): string | undefined {
  return typeof v === 'string' && v ? v.slice(0, max) : undefined;
}
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function kindOfId(id: string): string {
  const i = id.indexOf(':');
  return i > 0 ? id.slice(0, i) : 'entity';
}

export function newEntity(ev: PaEvent): Entity {
  return {
    id: ev.entity,
    kind: kindOfId(ev.entity),
    labels: {},
    status: 'idle',
    metrics: {},
    firstSeen: ev.ts,
    lastSeen: ev.ts,
    history: [],
    view: {},
  };
}

/** Tools per minute that count as full intensity (100). */
export const INTENSITY_FULL_TPM = 12;
/** Seconds without a tool call before the intensity starts to fade. */
export const INTENSITY_HOLD_SEC = 20;
/** Intensity points lost per second while fading. */
export const INTENSITY_DECAY = 4;

function summary(ev: PaEvent): string | undefined {
  const a = ev.attrs ?? {};
  switch (ev.kind) {
    case 'session.start': return `session started${str(a.source) ? ` (${str(a.source)})` : ''}`;
    case 'session.end': return `session ended${str(a.reason) ? ` (${str(a.reason)})` : ''}`;
    case 'turn.start': return 'new turn';
    case 'turn.end': {
      const parts = [];
      if (num(a.steps)) parts.push(`${num(a.steps)} steps`);
      const out = num((a.usage as TokenUsage | undefined)?.output);
      if (out) parts.push(`${out} tok out`);
      return `turn finished${parts.length ? ` (${parts.join(', ')})` : ''}`;
    }
    case 'tool.pre': return [str(a.tool) ?? 'tool', str(a.detail)].filter(Boolean).join(' ');
    case 'tool.post': return a.ok === false ? `${str(a.tool) ?? 'tool'} failed${str(a.error) ? ` (${str(a.error)})` : ''}` : undefined;
    case 'fork.start': return `subagent started${str(a.agent_type) ? ` (${str(a.agent_type)})` : ''}`;
    case 'fork.end': return 'subagent finished';
    case 'waiting.permission': return 'waiting for permission';
    case 'waiting.human': return 'waiting for a human';
    case 'compact': return `context compacted${str(a.trigger) ? ` (${str(a.trigger)})` : ''}`;
    case 'state': return `status ${str(a.status) ?? '?'}${str(a.reason) ? ` (${str(a.reason)})` : ''}`;
    case 'metric':
    case 'heartbeat': return undefined;
    default: return ev.kind + (str(a.detail) ? ' ' + str(a.detail) : '');
  }
}

const bump = (e: Entity, k: string, by = 1): number => (e.metrics[k] = (e.metrics[k] ?? 0) + by);

/** A pending wait is over: record how long it took. */
function closeWait(e: Entity, now: number): void {
  if (e.status !== 'waiting' || !e.activity) return;
  const ms = now - Date.parse(e.activity.since);
  if (!Number.isFinite(ms) || ms < 0) return;
  e.metrics.wait_ms_last = ms;
  bump(e, 'wait_ms_total', ms);
}

/** Tool-rate intensity (0..100): exponential average of the instantaneous tools/minute. */
function touchIntensity(e: Entity, ts: string): void {
  const now = Date.parse(ts);
  const last = e.turn?.lastToolAt ? Date.parse(e.turn.lastToolAt) : NaN;
  if (e.turn) e.turn.lastToolAt = ts;
  if (Number.isNaN(last) || Number.isNaN(now)) return;
  const dt = Math.max(250, now - last);
  const inst = Math.min(60, 60000 / dt);
  const tpm = (e.metrics.tools_per_min ?? inst) * 0.6 + inst * 0.4;
  e.metrics.tools_per_min = Math.round(tpm * 10) / 10;
  e.metrics.intensity = Math.min(100, Math.round((tpm / INTENSITY_FULL_TPM) * 100));
}

/** Called by the store every second: the intensity fades when no tool has run for a while. */
export function decayIntensity(e: Entity, nowMs: number): boolean {
  const cur = e.metrics.intensity;
  if (!cur) return false;
  const last = e.turn?.lastToolAt ? Date.parse(e.turn.lastToolAt) : NaN;
  const quiet = Number.isNaN(last) || nowMs - last > INTENSITY_HOLD_SEC * 1000;
  const working = e.status === 'working' || e.status === 'thinking';
  if (!quiet && working) return false;
  e.metrics.intensity = Math.max(0, cur - INTENSITY_DECAY);
  if (e.metrics.intensity === 0) e.metrics.tools_per_min = 0;
  return true;
}

function addUsage(e: Entity, a: Record<string, unknown>): void {
  const u = a.usage && typeof a.usage === 'object' ? (a.usage as TokenUsage) : undefined;
  if (u) {
    const inp = num(u.input) ?? 0, out = num(u.output) ?? 0, cr = num(u.cache_read) ?? 0, cw = num(u.cache_write) ?? 0;
    bump(e, 'tokens_in', inp); bump(e, 'tokens_out', out); bump(e, 'tokens_cache_read', cr); bump(e, 'tokens_cache_write', cw);
    e.metrics.turn_tokens_out = out;
    e.metrics.turn_tokens_in = inp + cr + cw;
  }
  if (num(a.context_tokens) !== undefined) e.metrics.context_tokens = num(a.context_tokens)!;
  if (str(a.model)) e.labels.model = str(a.model, 80)!;
  if (str(a.effort)) e.labels.effort = str(a.effort, 20)!;
}

/** Core reducer: mutates and returns the entity. Plugin reducers run after it. */
export function coreReduce(e: Entity, ev: PaEvent, historyMax: number): Entity {
  const a = ev.attrs ?? {};
  const nowMs = Date.parse(ev.ts);
  e.lastSeen = ev.ts;
  if (ev.labels) for (const [k, v] of Object.entries(ev.labels)) if (typeof v === 'string') e.labels[k] = v;
  if (ev.parent) e.parent = ev.parent;
  const act = (partial: Omit<Activity, 'since'>): Activity => ({ ...partial, since: ev.ts });

  switch (ev.kind) {
    case 'session.start':
      e.status = 'starting';
      e.activity = undefined;
      if (str(a.model)) e.labels.model = str(a.model)!;
      break;
    case 'tool.pre': {
      const tool = str(a.tool);
      closeWait(e, nowMs);
      e.status = 'working';
      e.activity = act({ tool, detail: str(a.detail), category: categoryOf(tool) });
      bump(e, 'tools');
      // Sources without turn events still get an (implicit, n = 0) turn so tool counts and intensity work.
      if (!e.turn || e.turn.until) e.turn = { since: ev.ts, n: 0, tools: 0, errors: 0, forks: 0, lastToolAt: e.turn?.lastToolAt };
      e.turn.tools++;
      touchIntensity(e, ev.ts);
      break;
    }
    case 'tool.post':
      // A tool that finished was allowed to run: a pending permission wait is over.
      if (e.status === 'waiting') {
        closeWait(e, nowMs);
        const tool = str(a.tool) ?? e.activity?.tool;
        e.status = 'working';
        e.activity = act({ tool, detail: str(a.detail), category: categoryOf(tool) });
      }
      if (a.ok === false) {
        bump(e, 'errors');
        bump(e, 'error_streak');
        if (e.turn && !e.turn.until) e.turn.errors++;
      } else if (e.metrics.error_streak) e.metrics.error_streak = 0;
      if (num(a.wait_ms) !== undefined) { e.metrics.wait_ms_last = num(a.wait_ms)!; bump(e, 'wait_ms_total', num(a.wait_ms)!); }
      break;
    case 'turn.start':
      e.status = 'thinking';
      e.activity = act({ category: 'think' });
      e.turn = { since: ev.ts, n: bump(e, 'turns'), tools: 0, errors: 0, forks: 0, lastToolAt: e.turn?.lastToolAt };
      e.metrics.turn_ms = 0;
      break;
    case 'turn.end': {
      closeWait(e, nowMs);
      e.status = 'idle';
      e.activity = undefined;
      if (!e.turn || e.turn.until) e.turn = { since: ev.ts, n: bump(e, 'turns'), tools: 0, errors: 0, forks: 0, lastToolAt: e.turn?.lastToolAt };
      e.turn.until = ev.ts;
      const ms = num(a.duration_ms) ?? nowMs - Date.parse(e.turn.since);
      if (Number.isFinite(ms) && ms >= 0) e.metrics.turn_ms = Math.round(ms);
      e.metrics.turn_tools = e.turn.tools;
      if (num(a.steps) !== undefined) e.metrics.turn_steps = num(a.steps)!;
      addUsage(e, a);
      break;
    }
    case 'waiting.permission':
    case 'waiting.human':
      e.status = 'waiting';
      e.activity = act({ tool: str(a.tool), detail: str(a.detail) ?? str(a.reason), category: 'wait' });
      bump(e, 'waits');
      break;
    case 'fork.start':
      e.status = 'starting';
      e.activity = undefined;
      if (str(a.agent_type)) e.labels.agent_type = str(a.agent_type, 60)!;
      if (str(a.model)) e.labels.model = str(a.model, 80)!;
      break;
    case 'fork.end':
      e.status = 'ended';
      e.activity = undefined;
      addUsage(e, a);
      if (num(a.duration_ms) !== undefined) e.metrics.turn_ms = Math.round(num(a.duration_ms)!);
      break;
    case 'session.end':
      e.status = 'ended';
      e.activity = undefined;
      break;
    case 'compact':
      bump(e, 'compactions');
      break;
    case 'state':
      if (e.status === 'waiting' && str(a.status) && str(a.status) !== 'waiting') closeWait(e, nowMs);
      if (str(a.status)) e.status = str(a.status)!;
      if (num(a.wait_ms) !== undefined) { e.metrics.wait_ms_last = num(a.wait_ms)!; bump(e, 'wait_ms_total', num(a.wait_ms)!); }
      break;
    case 'metric':
      for (const [k, v] of Object.entries(a)) if (typeof v === 'number' && Number.isFinite(v)) e.metrics[k] = v;
      break;
    default:
      break;
  }
  const s = summary(ev);
  if (s) {
    e.history.push({ ts: ev.ts, kind: ev.kind, summary: s });
    if (e.history.length > historyMax) e.history.splice(0, e.history.length - historyMax);
  }
  return e;
}

/**
 * Parent bookkeeping after a fork event: live subagents, total forks and the current turn's forks
 * of the parent entity. Called by the store, which marks the parent dirty.
 */
export function reduceParent(parent: Entity, ev: PaEvent, children: Iterable<Entity>): void {
  let live = 0;
  for (const c of children) if (c.parent === parent.id && c.status !== 'ended') live++;
  parent.metrics.subagents_live = live;
  if (ev.kind === 'fork.start') {
    bump(parent, 'forks');
    if (parent.turn && !parent.turn.until) parent.turn.forks++;
  }
}
