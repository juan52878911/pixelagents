import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { HookLine, TokenUsage } from '@pixelagents/protocol';

/** Minimal read-only filesystem view used to find the repo/branch and to tail the transcript. */
export interface HookFs {
  stat(path: string): 'dir' | 'file' | null;
  read(path: string): string | null;
  /** Last `bytes` of a file (whole file when smaller). Falls back to `read` when missing. */
  tail?(path: string, bytes: number): string | null;
}

export const nodeHookFs: HookFs = {
  stat(p) {
    try {
      return statSync(p).isDirectory() ? 'dir' : 'file';
    } catch {
      return null;
    }
  },
  read(p) {
    try {
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    } catch {
      return null;
    }
  },
  tail(p, bytes) {
    let fd: number | null = null;
    try {
      fd = openSync(p, 'r');
      const size = fstatSync(fd).size;
      const n = Math.min(size, bytes);
      const buf = Buffer.allocUnsafe(n);
      readSync(fd, buf, 0, n, size - n);
      return buf.toString('utf8');
    } catch {
      return null;
    } finally {
      if (fd !== null) closeSync(fd);
    }
  },
};

/** Bytes of transcript read at Stop/SubagentStop. Enough for most turns; longer ones report partial sums. */
export const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

export interface TurnUsage {
  usage: TokenUsage;
  steps: number;
  contextTokens?: number;
  usageModel?: string;
  turnMs?: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Sums the usage of the assistant steps of the last turn of a Claude Code transcript (JSONL). Walks
 * the tail backwards until the user message that started the turn. Only `type`, `timestamp`,
 * `message.model`, `message.usage` and the content block types are looked at: never any text.
 */
export function turnUsageFromTranscript(text: string | null): TurnUsage | null {
  if (!text) return null;
  const lines = text.split('\n');
  const usage: Required<TokenUsage> = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let steps = 0, contextTokens: number | undefined, usageModel: string | undefined, first: number | undefined, last: number | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line || line[0] !== '{') continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const msg = o.message && typeof o.message === 'object' ? (o.message as Record<string, unknown>) : null;
    if (o.type === 'user') {
      const content = msg?.content;
      const toolResult = Array.isArray(content) && content.some((c) => c && typeof c === 'object' && (c as Record<string, unknown>).type === 'tool_result');
      if (!toolResult && !o.isMeta) break; // the prompt that started this turn
      continue;
    }
    if (o.type !== 'assistant' || !msg) continue;
    const u = msg.usage && typeof msg.usage === 'object' ? (msg.usage as Record<string, unknown>) : null;
    if (!u) continue;
    const inp = num(u.input_tokens), out = num(u.output_tokens), cr = num(u.cache_read_input_tokens), cw = num(u.cache_creation_input_tokens);
    if (steps === 0) {
      contextTokens = inp + cr + cw;
      if (typeof msg.model === 'string' && msg.model) usageModel = msg.model.slice(0, 80);
    }
    steps++;
    usage.input += inp; usage.output += out; usage.cache_read += cr; usage.cache_write += cw;
    const t = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    if (!Number.isNaN(t)) {
      if (last === undefined) last = t;
      first = t;
    }
  }
  if (!steps) return null;
  const r: TurnUsage = { usage, steps };
  if (contextTokens !== undefined) r.contextTokens = contextTokens;
  if (usageModel) r.usageModel = usageModel;
  if (first !== undefined && last !== undefined && last >= first) r.turnMs = last - first;
  return r;
}

export interface BuildOptions {
  now?: () => string;
  user?: string;
  hostname?: string;
  cwd?: string;
}

const MAX_DETAIL = 120;
const DETAIL_KEYS = ['file_path', 'pattern', 'path', 'command', 'query', 'url'] as const;
const KIND: Record<string, HookLine['kind']> = {
  SessionStart: 'session.start',
  SessionEnd: 'session.end',
  UserPromptSubmit: 'turn.start',
  Stop: 'turn.end',
  PreToolUse: 'tool.pre',
  PostToolUse: 'tool.post',
  PostToolUseFailure: 'tool.post',
  SubagentStart: 'fork.start',
  SubagentStop: 'fork.end',
  PreCompact: 'compact',
};
/** Notification.notification_type → kind; the rest are not states and are dropped (kind 'other'). */
const NOTIFICATION: Record<string, HookLine['kind']> = {
  permission_prompt: 'waiting.permission',
  idle_prompt: 'waiting.human',
  agent_needs_input: 'waiting.human',
  elicitation_dialog: 'waiting.human',
  elicitation_url_dialog: 'waiting.human',
};

/** Short, text-free kind of a tool error: "exit 1", "interrupt" or "error". */
export function errorKind(error: unknown, interrupt: unknown): string {
  if (interrupt === true) return 'interrupt';
  const m = typeof error === 'string' ? /^Exit code (\d+)/.exec(error) : null;
  return m ? `exit ${m[1]}` : 'error';
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const firstLine = (v: string): string => {
  const s = (v.split('\n')[0] ?? '').replace(/\r$/, '');
  return s.length > MAX_DETAIL ? s.slice(0, MAX_DETAIL) : s;
};

function readHead(fs: HookFs, gitdir: string): string | undefined {
  const head = fs.read(join(gitdir, 'HEAD'));
  if (!head) return undefined;
  const m = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head);
  if (m) return m[1];
  const sha = head.trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : undefined;
}

/** Walk up from cwd with fs only. Worktrees resolve to the main repo through `commondir`. */
export function resolveRepo(cwd: string, fs: HookFs = nodeHookFs): { repo: string; branch?: string } | null {
  let dir = resolve(cwd);
  for (;;) {
    const g = join(dir, '.git');
    const k = fs.stat(g);
    if (k === 'dir') return { repo: basename(dir), branch: readHead(fs, g) };
    if (k === 'file') {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.read(g) ?? '');
      if (m && m[1]) {
        const gitdir = resolve(dir, m[1]);
        const common = fs.read(join(gitdir, 'commondir'));
        let name = basename(dir);
        if (common && common.trim()) {
          const cd = resolve(gitdir, common.trim());
          name = basename(cd) === '.git' ? basename(dirname(cd)) : basename(cd).replace(/\.git$/, '');
        }
        return { repo: name, branch: readHead(fs, gitdir) };
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Pure mapping Claude Code hook payload -> HookLine v1 (null if it is not a hook payload). */
export function buildHookLine(
  payload: unknown,
  env: Record<string, string | undefined>,
  fs: HookFs = nodeHookFs,
  opts: BuildOptions = {},
): HookLine | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const hook = str(p.hook_event_name);
  if (!hook) return null;
  const cwd = str(p.cwd) ?? opts.cwd ?? process.cwd();
  const cfg = env.CLAUDE_CONFIG_DIR ? basename(env.CLAUDE_CONFIG_DIR.replace(/\/+$/, '')) : '';
  let host = env.PIXELAGENTS_HOST;
  if (!host) {
    try {
      host = (opts.hostname ?? hostname()).split('.')[0];
    } catch {
      /* ignore */
    }
  }
  let agent: string;
  try {
    agent = opts.user ?? userInfo().username;
  } catch {
    agent = env.USER || 'unknown';
  }
  const git = resolveRepo(cwd, fs);
  const line: HookLine = {
    v: 1,
    ts: (opts.now ?? (() => new Date().toISOString()))(),
    session: str(p.session_id) ?? 'unknown',
    kind: 'other',
    agent,
    account: env.PIXELAGENTS_ACCOUNT || cfg || 'default',
    host: host || 'unknown',
    cwd,
    repo: git ? git.repo : basename(cwd) || cwd,
  };
  if (git?.branch) line.branch = git.branch;
  const model = str(p.model);
  if (model) line.model = model.slice(0, 80);

  const pm = str(p.permission_mode);
  if (pm) line.permissionMode = pm.slice(0, 40);
  const effort = p.effort && typeof p.effort === 'object' ? str((p.effort as Record<string, unknown>).level) : undefined;
  if (effort) line.effort = effort.slice(0, 20);
  const agentType = str(p.agent_type);
  if (agentType) line.agentType = agentType.slice(0, 60);

  if (hook === 'Notification') {
    const nt = str(p.notification_type);
    if (nt) line.kind = NOTIFICATION[nt] ?? 'other';
    else line.kind = /permission/i.test(typeof p.message === 'string' ? p.message : '') ? 'waiting.permission' : 'waiting.human';
  } else if (KIND[hook]) {
    line.kind = KIND[hook]!;
  } else {
    line.tool = hook;
  }
  if (hook === 'SessionStart' || hook === 'PreCompact') {
    const src = str(p.source) ?? str(p.trigger);
    if (src) line.source = src.slice(0, 20);
  }
  if (hook === 'SessionEnd') {
    const reason = str(p.reason);
    if (reason) line.reason = reason.slice(0, 40);
  }
  if (hook === 'PreToolUse' || hook === 'PostToolUse' || hook === 'PostToolUseFailure') {
    line.tool = str(p.tool_name) ?? 'unknown';
    const input = p.tool_input && typeof p.tool_input === 'object' ? (p.tool_input as Record<string, unknown>) : {};
    for (const k of DETAIL_KEYS) {
      const v = str(input[k]);
      if (v !== undefined) {
        line.detail = firstLine(v);
        break;
      }
    }
    if (typeof p.duration_ms === 'number' && Number.isFinite(p.duration_ms)) line.durationMs = Math.round(p.duration_ms);
    if (hook === 'PostToolUseFailure') {
      line.ok = false;
      line.error = errorKind(p.error, p.is_interrupt);
    }
  }
  if (hook === 'SubagentStart' || hook === 'SubagentStop') {
    const id = str(p.agent_id);
    if (id) {
      line.parent = line.session;
      line.session = `${line.session}:${id}`;
    }
  }
  if (hook === 'Stop' || hook === 'SubagentStop') {
    const path = str(hook === 'Stop' ? p.transcript_path : p.agent_transcript_path);
    if (path) {
      const tu = turnUsageFromTranscript(fs.tail ? fs.tail(path, TRANSCRIPT_TAIL_BYTES) : fs.read(path));
      if (tu) {
        line.usage = tu.usage;
        line.steps = tu.steps;
        if (tu.contextTokens !== undefined) line.contextTokens = tu.contextTokens;
        if (tu.usageModel) line.usageModel = tu.usageModel;
        if (tu.turnMs !== undefined) line.turnMs = tu.turnMs;
      }
    }
  }
  return line;
}
