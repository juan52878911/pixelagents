#!/usr/bin/env node
// Claude Code hook emitter (CommonJS via bin/package.json: faster startup than ESM). Plain JS, node: built-ins only, always exits 0, silent.
// Logic mirrors src/hook-line.ts (buildHookLine); test/emit-parity.test.ts fails on drift.
// Privacy: never reads prompt, tool_input.content|old_string|new_string, tool_response, error text or
// transcript text (only usage numbers, model and timestamps of the last turn).
const { appendFileSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, statSync } = require('node:fs');
const { homedir, hostname, userInfo } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');

const MAX_DETAIL = 120;
const DETAIL_KEYS = ['file_path', 'pattern', 'path', 'command', 'query', 'url'];
const KIND = {
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
const NOTIFICATION = {
  permission_prompt: 'waiting.permission',
  idle_prompt: 'waiting.human',
  agent_needs_input: 'waiting.human',
  elicitation_dialog: 'waiting.human',
  elicitation_url_dialog: 'waiting.human',
};
const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

const str = (v) => (typeof v === 'string' && v.length > 0 ? v : undefined);
const firstLine = (v) => {
  const s = (v.split('\n')[0] || '').replace(/\r$/, '');
  return s.length > MAX_DETAIL ? s.slice(0, MAX_DETAIL) : s;
};
const kindOf = (p) => {
  try {
    return statSync(p).isDirectory() ? 'dir' : 'file';
  } catch {
    return null;
  }
};
const read = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const tail = (p, bytes) => {
  let fd = null;
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
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function errorKind(error, interrupt) {
  if (interrupt === true) return 'interrupt';
  const m = typeof error === 'string' ? /^Exit code (\d+)/.exec(error) : null;
  return m ? `exit ${m[1]}` : 'error';
}

// Usage of the last turn: assistant steps after the last real user message. Structure only, never text.
function turnUsageFromTranscript(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let steps = 0, contextTokens, usageModel, first, last;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line[0] !== '{') continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = o.message && typeof o.message === 'object' ? o.message : null;
    if (o.type === 'user') {
      const content = msg ? msg.content : undefined;
      const toolResult = Array.isArray(content) && content.some((c) => c && typeof c === 'object' && c.type === 'tool_result');
      if (!toolResult && !o.isMeta) break;
      continue;
    }
    if (o.type !== 'assistant' || !msg) continue;
    const u = msg.usage && typeof msg.usage === 'object' ? msg.usage : null;
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
  const r = { usage, steps };
  if (contextTokens !== undefined) r.contextTokens = contextTokens;
  if (usageModel) r.usageModel = usageModel;
  if (first !== undefined && last !== undefined && last >= first) r.turnMs = last - first;
  return r;
}

function readHead(gitdir) {
  const head = read(join(gitdir, 'HEAD'));
  if (!head) return undefined;
  const m = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(head);
  if (m) return m[1];
  const sha = head.trim();
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7) : undefined;
}

function repoOf(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    const g = join(dir, '.git');
    const k = kindOf(g);
    if (k === 'dir') return { repo: basename(dir), branch: readHead(g) };
    if (k === 'file') {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(read(g) || '');
      if (m && m[1]) {
        const gitdir = resolve(dir, m[1]);
        const common = read(join(gitdir, 'commondir'));
        let name = basename(dir);
        if (common && common.trim()) {
          const cd = resolve(gitdir, common.trim());
          name = basename(cd) === '.git' ? basename(dirname(cd)) : basename(cd).replace(/\.git$/, '');
        }
        return { repo: name, branch: readHead(gitdir) };
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function build(p, env, ts) {
  if (!p || typeof p !== 'object') return null;
  const hook = str(p.hook_event_name);
  if (!hook) return null;
  const cwd = str(p.cwd) || process.cwd();
  const cfg = env.CLAUDE_CONFIG_DIR ? basename(env.CLAUDE_CONFIG_DIR.replace(/\/+$/, '')) : '';
  let host = env.PIXELAGENTS_HOST;
  if (!host) {
    try {
      host = hostname().split('.')[0];
    } catch {
      /* ignore */
    }
  }
  let agent;
  try {
    agent = userInfo().username;
  } catch {
    agent = env.USER || 'unknown';
  }
  const git = repoOf(cwd);
  const line = {
    v: 1,
    ts,
    session: str(p.session_id) || 'unknown',
    kind: 'other',
    agent,
    account: env.PIXELAGENTS_ACCOUNT || cfg || 'default',
    host: host || 'unknown',
    cwd,
    repo: git ? git.repo : basename(cwd) || cwd,
  };
  if (git && git.branch) line.branch = git.branch;
  const model = str(p.model);
  if (model) line.model = model.slice(0, 80);

  const pm = str(p.permission_mode);
  if (pm) line.permissionMode = pm.slice(0, 40);
  const effort = p.effort && typeof p.effort === 'object' ? str(p.effort.level) : undefined;
  if (effort) line.effort = effort.slice(0, 20);
  const agentType = str(p.agent_type);
  if (agentType) line.agentType = agentType.slice(0, 60);

  if (hook === 'Notification') {
    const nt = str(p.notification_type);
    if (nt) line.kind = NOTIFICATION[nt] || 'other';
    else line.kind = /permission/i.test(typeof p.message === 'string' ? p.message : '') ? 'waiting.permission' : 'waiting.human';
  } else if (KIND[hook]) {
    line.kind = KIND[hook];
  } else {
    line.tool = hook;
  }
  if (hook === 'SessionStart' || hook === 'PreCompact') {
    const src = str(p.source) || str(p.trigger);
    if (src) line.source = src.slice(0, 20);
  }
  if (hook === 'SessionEnd') {
    const reason = str(p.reason);
    if (reason) line.reason = reason.slice(0, 40);
  }
  if (hook === 'PreToolUse' || hook === 'PostToolUse' || hook === 'PostToolUseFailure') {
    line.tool = str(p.tool_name) || 'unknown';
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
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
      const tu = turnUsageFromTranscript(tail(path, TRANSCRIPT_TAIL_BYTES));
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

function main() {
  try {
    let raw = '';
    try {
      raw = readFileSync(0, 'utf8');
    } catch {
      return;
    }
    if (!raw.trim()) return;
    const line = build(JSON.parse(raw), process.env, new Date().toISOString());
    if (!line) return;
    const dir = process.env.PIXELAGENTS_DIR || join(homedir(), '.pixelagents');
    const file = join(dir, 'events.jsonl');
    const data = JSON.stringify(line) + '\n';
    try {
      appendFileSync(file, data);
    } catch {
      mkdirSync(dir, { recursive: true });
      appendFileSync(file, data);
    }
  } catch {
    // silent by design
  }
}

main();
process.exitCode = 0;
