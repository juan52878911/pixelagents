#!/usr/bin/env node
// Claude Code hook emitter (CommonJS via bin/package.json: faster startup than ESM). Plain JS, node: built-ins only, always exits 0, silent.
// Logic mirrors src/hook-line.ts (buildHookLine); test/emit-parity.test.ts fails on drift.
// Privacy: never reads prompt, tool_input.content|old_string|new_string or tool_response.
const { appendFileSync, mkdirSync, readFileSync, statSync } = require('node:fs');
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
  SubagentStart: 'fork.start',
  SubagentStop: 'fork.end',
};

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

  if (hook === 'Notification') {
    line.kind = /permission/i.test(typeof p.message === 'string' ? p.message : '') ? 'waiting.permission' : 'waiting.human';
  } else if (KIND[hook]) {
    line.kind = KIND[hook];
  } else {
    line.tool = hook;
  }
  if (hook === 'PreToolUse' || hook === 'PostToolUse') {
    line.tool = str(p.tool_name) || 'unknown';
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
    for (const k of DETAIL_KEYS) {
      const v = str(input[k]);
      if (v !== undefined) {
        line.detail = firstLine(v);
        break;
      }
    }
  }
  if (hook === 'SubagentStart' || hook === 'SubagentStop') {
    const id = str(p.agent_id);
    if (id) {
      line.parent = line.session;
      line.session = `${line.session}:${id}`;
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
