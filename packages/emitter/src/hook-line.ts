import { existsSync, readFileSync, statSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { HookLine } from '@pixelagents/protocol';

/** Minimal read-only filesystem view used to find the git repo/branch. */
export interface HookFs {
  stat(path: string): 'dir' | 'file' | null;
  read(path: string): string | null;
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
};

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
  SubagentStart: 'fork.start',
  SubagentStop: 'fork.end',
};

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

  if (hook === 'Notification') {
    line.kind = /permission/i.test(typeof p.message === 'string' ? p.message : '') ? 'waiting.permission' : 'waiting.human';
  } else if (KIND[hook]) {
    line.kind = KIND[hook]!;
  } else {
    line.tool = hook;
  }
  if (hook === 'PreToolUse' || hook === 'PostToolUse') {
    line.tool = str(p.tool_name) ?? 'unknown';
    const input = p.tool_input && typeof p.tool_input === 'object' ? (p.tool_input as Record<string, unknown>) : {};
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
