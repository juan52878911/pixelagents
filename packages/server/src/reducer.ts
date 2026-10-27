import type { Activity, ActivityCategory, Entity, PaEvent } from '@pixelagents/protocol';

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

function summary(ev: PaEvent): string | undefined {
  const a = ev.attrs ?? {};
  switch (ev.kind) {
    case 'session.start': return 'session started';
    case 'session.end': return 'session ended';
    case 'turn.start': return 'new turn';
    case 'turn.end': return 'turn finished';
    case 'tool.pre': return [str(a.tool) ?? 'tool', str(a.detail)].filter(Boolean).join(' ');
    case 'tool.post': return a.ok === false ? `${str(a.tool) ?? 'tool'} failed` : undefined;
    case 'fork.start': return 'subagent started';
    case 'fork.end': return 'subagent finished';
    case 'waiting.permission': return 'waiting for permission';
    case 'waiting.human': return 'waiting for a human';
    case 'state': return `status ${str(a.status) ?? '?'}${str(a.reason) ? ` (${str(a.reason)})` : ''}`;
    case 'metric':
    case 'heartbeat': return undefined;
    default: return ev.kind + (str(a.detail) ? ' ' + str(a.detail) : '');
  }
}

/** Core reducer: mutates and returns the entity. Plugin reducers run after it. */
export function coreReduce(e: Entity, ev: PaEvent, historyMax: number): Entity {
  const a = ev.attrs ?? {};
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
      e.status = 'working';
      e.activity = act({ tool, detail: str(a.detail), category: categoryOf(tool) });
      break;
    }
    case 'tool.post':
      // A tool that finished was allowed to run: a pending permission wait is over.
      if (e.status === 'waiting') {
        const tool = str(a.tool) ?? e.activity?.tool;
        e.status = 'working';
        e.activity = act({ tool, detail: str(a.detail), category: categoryOf(tool) });
      }
      break;
    case 'turn.start':
      e.status = 'thinking';
      e.activity = act({ category: 'think' });
      break;
    case 'turn.end':
      e.status = 'idle';
      e.activity = undefined;
      break;
    case 'waiting.permission':
    case 'waiting.human':
      e.status = 'waiting';
      e.activity = act({ tool: str(a.tool), detail: str(a.detail) ?? str(a.reason), category: 'wait' });
      break;
    case 'fork.start':
      e.status = 'starting';
      e.activity = undefined;
      break;
    case 'fork.end':
    case 'session.end':
      e.status = 'ended';
      e.activity = undefined;
      break;
    case 'state':
      if (str(a.status)) e.status = str(a.status)!;
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
