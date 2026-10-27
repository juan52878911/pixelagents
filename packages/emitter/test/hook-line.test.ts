import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_KINDS } from '@pixelagents/protocol';
import { buildHookLine, type HookFs } from '../src/index.js';
import { makeRepo, tmp } from './helpers.js';

const payloads = JSON.parse(readFileSync(new URL('../../../fixtures/hook-payloads.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
const noGit: HookFs = { stat: () => null, read: () => null };
const opts = { now: () => '2026-01-01T00:00:00.000Z', user: 'tester', hostname: 'box.local' };
const env = { PIXELAGENTS_ACCOUNT: 'work' };

describe('buildHookLine over fixtures', () => {
  const lines = payloads.map((p) => buildHookLine(p, env, noGit, opts)!);

  it('maps every payload', () => {
    expect(lines.map((l) => [l.kind, l.tool, l.detail, l.session, l.parent])).toEqual([
      ['session.start', undefined, undefined, 'abc', undefined],
      ['turn.start', undefined, undefined, 'abc', undefined],
      ['tool.pre', 'Edit', '/home/dev/code/web-app/src/app.ts', 'abc', undefined],
      ['tool.pre', 'Bash', 'npm test -- --run', 'abc', undefined],
      ['tool.post', 'Bash', undefined, 'abc', undefined],
      ['waiting.permission', undefined, undefined, 'abc', undefined],
      ['fork.start', undefined, undefined, 'abc:sub-1', 'abc'],
      ['fork.end', undefined, undefined, 'abc:sub-1', 'abc'],
      ['turn.end', undefined, undefined, 'abc', undefined],
      ['session.end', undefined, undefined, 'abc', undefined],
    ]);
  });

  it('fills the common fields', () => {
    for (const l of lines) {
      expect(l).toMatchObject({ v: 1, ts: opts.now(), agent: 'tester', account: 'work', host: 'box', cwd: '/home/dev/code/web-app', repo: 'web-app' });
      expect(CORE_KINDS as readonly string[]).toContain(l.kind);
    }
  });

  it('never leaks SECRET', () => {
    expect(JSON.stringify(lines)).not.toContain('SECRET');
  });
});

describe('buildHookLine rules', () => {
  const base = { hook_event_name: 'PreToolUse', session_id: 's', cwd: '/x/y' };
  const b = (p: object, e: Record<string, string> = {}) => buildHookLine({ ...base, ...p }, e, noGit, opts)!;

  it('account: PIXELAGENTS_ACCOUNT > CLAUDE_CONFIG_DIR basename > default', () => {
    expect(b({}, { PIXELAGENTS_ACCOUNT: 'a', CLAUDE_CONFIG_DIR: '/h/.claude-b' }).account).toBe('a');
    expect(b({}, { CLAUDE_CONFIG_DIR: '/h/.claude-b/' }).account).toBe('.claude-b');
    expect(b({}).account).toBe('default');
  });

  it('host: PIXELAGENTS_HOST > short hostname', () => {
    expect(b({}, { PIXELAGENTS_HOST: 'vm1' }).host).toBe('vm1');
    expect(b({}).host).toBe('box');
  });

  it('detail: first key found, first line, <= 120 chars', () => {
    expect(b({ tool_name: 'Grep', tool_input: { pattern: 'foo', path: '/p' } }).detail).toBe('foo');
    expect(b({ tool_name: 'Glob', tool_input: { path: '/p' } }).detail).toBe('/p');
    expect(b({ tool_name: 'WebFetch', tool_input: { url: 'http://u' } }).detail).toBe('http://u');
    expect(b({ tool_name: 'WebSearch', tool_input: { query: 'q' } }).detail).toBe('q');
    expect(b({ tool_name: 'Bash', tool_input: { command: 'a\nb' } }).detail).toBe('a');
    expect(b({ tool_name: 'Bash', tool_input: { command: 'x'.repeat(500) } }).detail).toHaveLength(120);
    expect(b({ tool_name: 'Write', tool_input: { content: 'SECRET' } }).detail).toBeUndefined();
  });

  it('model, notification, unknown hook', () => {
    expect(b({ hook_event_name: 'SessionStart', model: 'opus' }).model).toBe('opus');
    expect(b({ hook_event_name: 'Notification', message: 'Claude is waiting for your input' }).kind).toBe('waiting.human');
    expect(b({ hook_event_name: 'PreCompact', trigger: 'auto' })).toMatchObject({ kind: 'compact', source: 'auto' });
    expect(b({ hook_event_name: 'Setup' })).toMatchObject({ kind: 'other', tool: 'Setup' });
    expect(buildHookLine({ nope: 1 }, {}, noGit, opts)).toBeNull();
    expect(buildHookLine('x', {}, noGit, opts)).toBeNull();
  });
});

describe('repo and branch', () => {
  const { repo, worktree } = makeRepo('my-repo', 'main', 'feature/x');
  const at = (cwd: string) => buildHookLine({ hook_event_name: 'Stop', session_id: 's', cwd }, {})!;

  it('git repo, from the root and from a subfolder', () => {
    expect(at(repo)).toMatchObject({ repo: 'my-repo', branch: 'main' });
    expect(at(join(repo, 'src', 'deep'))).toMatchObject({ repo: 'my-repo', branch: 'main' });
  });

  it('worktree resolves to the main repo name with its own branch', () => {
    expect(basename(worktree)).not.toBe('my-repo');
    expect(at(worktree)).toMatchObject({ repo: 'my-repo', branch: 'feature/x' });
    expect(at(join(worktree, 'src'))).toMatchObject({ repo: 'my-repo', branch: 'feature/x' });
  });

  it('no git: basename(cwd), no branch', () => {
    const d = join(tmp(), 'plain');
    const l = buildHookLine({ hook_event_name: 'Stop', session_id: 's', cwd: d }, {}, noGit)!;
    expect(l.repo).toBe('plain');
    expect(l.branch).toBeUndefined();
  });
});
