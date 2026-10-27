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

/** The turn in progress (or the last one, when `until` is set). Kept by the core reducer. */
export interface TurnState {
  /** ISO time the turn started (turn.start). */
  since: string;
  /** Set when the turn finished (turn.end); the next turn.start replaces the whole object. */
  until?: string;
  /** Ordinal of this turn in the session (1-based). */
  n: number;
  /** Tool calls (tool.pre) so far in this turn. */
  tools: number;
  /** Failed tool calls in this turn. */
  errors: number;
  /** Subagents launched during this turn. */
  forks: number;
  /** ISO time of the last tool call, for the intensity decay. */
  lastToolAt?: string;
}

export interface Entity {
  id: string;
  /** "agent", "subagent", "vm", "host", … (prefix of the id). */
  kind: string;
  parent?: string;
  labels: Record<string, string>;
  status: EntityStatus;
  activity?: Activity;
  /**
   * Numbers: cost_usd, tokens, cpu_pct, load… The core reducer keeps these (all optional, present once
   * seen): turns, tools, errors, error_streak, compactions, forks, subagents_live, tokens_in, tokens_out,
   * tokens_cache_read, tokens_cache_write, turn_ms, turn_tools, turn_tokens_out, context_tokens,
   * waits, wait_ms_last, wait_ms_total, tools_per_min, intensity (0..100).
   */
  metrics: Record<string, number>;
  /** Current or last turn, when the source reports turns. */
  turn?: TurnState;
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
