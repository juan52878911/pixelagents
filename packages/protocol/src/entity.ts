/** What the agent is doing right now — the line you read at a glance. */
export interface Activity {
  /** Tool or action name ("Edit", "Bash", "vm.boot"). */
  tool?: string;
  /** Short detail: a path, a command, a url (≤120 chars). */
  detail?: string;
  /** Coarse bucket used for icons and animations: read, edit, run, web, think, talk, wait, other. */
  category?: ActivityCategory;
  /** ISO time it started; the UI shows elapsed time from here. */
  since: string;
}
export type ActivityCategory = 'read' | 'edit' | 'run' | 'web' | 'think' | 'talk' | 'wait' | 'other';

/**
 * Open set of statuses. The core reducers use these; plugins may set others
 * (kindling uses "frozen", "failed") and map them to behaviors in config.
 */
export type EntityStatus =
  | 'starting'
  | 'working'
  | 'thinking'
  | 'waiting'
  | 'idle'
  | 'sleeping'
  | 'ended'
  | (string & {});

export interface HistoryItem {
  ts: string;
  kind: string;
  /** One readable line ("Edit src/app.ts", "waiting for permission"). */
  summary: string;
}

/** Classification output: how the world shows this entity. Filled by config `classify` rules. */
export interface ViewProps {
  /** Group (office) id this entity belongs to. */
  group?: string;
  /** Skin name from config `skins` (palette + accessory). */
  skin?: string;
  /** Behavior set name from config `behaviors`. */
  behavior?: string;
  /** Hide from the world (still in the inspector list). */
  hidden?: boolean;
  [key: string]: unknown;
}

export interface Entity {
  id: string;
  /** "agent", "subagent", "vm", "host", … (prefix of the id). */
  kind: string;
  parent?: string;
  labels: Record<string, string>;
  status: EntityStatus;
  activity?: Activity;
  /** Numbers: cost_usd, tokens, cpu_pct, load… */
  metrics: Record<string, number>;
  firstSeen: string;
  lastSeen: string;
  /** Most recent last, capped (config `history.max`). */
  history: HistoryItem[];
  view: ViewProps;
}

/** An office: a set of entities grouped by a rule. */
export interface Group {
  id: string;
  /** Room type used by the world: "office", "lab", "server", … (config `groups.kinds`). */
  kind: string;
  label: string;
  labels: Record<string, string>;
  metrics: Record<string, number>;
}

export interface StateSnapshot {
  protocol: number;
  seq: number;
  entities: Entity[];
  groups: Group[];
}

/** Sent over SSE after the snapshot. Apply in seq order. */
export interface Delta {
  seq: number;
  upsert?: Entity[];
  remove?: string[];
  groups?: Group[];
  removeGroups?: string[];
  /** Raw events of this tick, for feeds and one-shot effects (emojis, gags). */
  events?: import('./events.js').PaEvent[];
}
