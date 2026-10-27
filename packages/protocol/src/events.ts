/**
 * The one thing every source turns into. Adapters produce PaEvents; reducers fold them into entities.
 *
 * `entity` is a stable id chosen by the adapter, namespaced by kind: "agent:<session>", "vm:<id>",
 * "host:<name>". Events for an entity that does not exist yet create it.
 */
export interface PaEvent {
  /** ISO-8601 timestamp of when it happened at the source. */
  ts: string;
  /** Id of the input that produced it (from config `inputs[].id`). Set by the server. */
  source: string;
  /** Stable entity id, `<kind>:<id>`. */
  entity: string;
  /** Dotted event kind. Core kinds are listed in CORE_KINDS; plugins may add their own. */
  kind: string;
  /** Kind-specific payload. Never prompt text, file contents or env values. */
  attrs?: Record<string, unknown>;
  /** Labels merged into the entity (account, host, repo…). Classification reads these. */
  labels?: Record<string, string>;
  /** Parent entity id (a subagent's agent, an agent's vm). */
  parent?: string;
}

/** Kinds the core reducers understand. Anything else is kept in history and passed to plugin reducers. */
export const CORE_KINDS = [
  'session.start', // entity appears (attrs.model?)
  'session.end', // entity leaves
  'turn.start', // the agent got a new prompt
  'turn.end', // the agent finished its turn and is idle
  'tool.pre', // attrs: { tool, detail? }
  'tool.post', // attrs: { tool, ok? }
  'fork.start', // a subagent starts: entity = the subagent, parent = the agent
  'fork.end',
  'waiting.permission', // the agent waits for the human to allow something
  'waiting.human', // the agent waits for an answer
  'state', // generic status change: attrs: { status, reason? }
  'metric', // attrs: { name: value, … } numbers merged into entity.metrics
  'heartbeat', // keeps the entity alive, no change
  'compact', // the agent's context was compacted: attrs: { trigger?: 'auto' | 'manual' }
] as const;
export type CoreKind = (typeof CORE_KINDS)[number];

/**
 * Optional attrs the core reducer understands on some kinds (all additive, all numbers or short enums):
 * - session.start: { model?, source?: 'startup'|'resume'|'clear'|'compact'|'fork', permission_mode?, agent_type? }
 * - session.end:   { reason? }
 * - tool.post:     { tool, ok?, error?: short kind ('exit 1', 'interrupt', 'error'), duration_ms? }
 * - turn.end:      { duration_ms?, steps?, usage?: TokenUsage, model?, effort?, context_tokens?, outcome? }
 * - fork.start:    { agent_type?, model? }
 * - waiting.*:     { tool?, reason? }; a later `state`/`tool.post` may carry { wait_ms? }
 * - compact:       { trigger? }
 */
export interface TokenUsage {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

/** Event line written by the Claude Code hook emitter (packages/emitter). Version 1 of the wire format. */
export interface HookLine {
  v: 1;
  ts: string;
  session: string;
  /** Claude Code hook name mapped to a core kind. */
  kind: CoreKind | 'other';
  agent: string; // OS user
  account: string; // CLAUDE_CONFIG_DIR basename or PIXELAGENTS_ACCOUNT, default "default"
  host: string; // short hostname or PIXELAGENTS_HOST
  cwd: string;
  repo: string; // git toplevel name (worktrees resolve to their main repo), else basename(cwd)
  branch?: string;
  tool?: string;
  detail?: string; // ≤120 chars: path, pattern, command or url only
  model?: string;
  parent?: string; // session id of the parent for subagents
  // ---- additive, all optional: structure and numbers only, never text ----
  source?: string; // SessionStart.source, PreCompact.trigger
  reason?: string; // SessionEnd.reason
  agentType?: string; // SubagentStart/Stop.agent_type, SessionStart.agent_type
  permissionMode?: string;
  effort?: string; // effort.level when the hook carries it
  ok?: boolean; // tool.post: false on PostToolUseFailure
  error?: string; // short error kind ("exit 1", "interrupt", "error"), never the message
  durationMs?: number; // PostToolUse.duration_ms
  usage?: TokenUsage; // turn.end / fork.end: tokens of the turn, read from the transcript (numbers only)
  contextTokens?: number; // size of the context at the last step (input + cache tokens)
  steps?: number; // assistant steps in the turn
  turnMs?: number; // wall time of the turn as seen in the transcript
  usageModel?: string; // model reported by the transcript for the turn
}
