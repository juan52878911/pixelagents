import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHookLine } from '../src/index.js';
import { makeRepo, tmp } from './helpers.js';

const emit = new URL('../bin/emit.js', import.meta.url).pathname;
const payloads = JSON.parse(readFileSync(new URL('../../../fixtures/hook-payloads.json', import.meta.url), 'utf8')) as Record<string, unknown>[];

function runEmit(payload: unknown, env: Record<string, string>, dir: string, input?: string) {
  const r = spawnSync(process.execPath, [emit], {
    input: input ?? JSON.stringify(payload),
    env: { PATH: process.env.PATH ?? '', PIXELAGENTS_DIR: dir, ...env },
    encoding: 'utf8',
  });
  const file = join(dir, 'events.jsonl');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, lines };
}

describe('emit.js', () => {
  it('matches buildHookLine on fixtures, repos, worktrees and extra cases', () => {
    const { repo, worktree } = makeRepo('parity-repo', 'main', 'wt/branch');
    const extra = [
      { hook_event_name: 'PreToolUse', session_id: 's', cwd: repo, tool_name: 'Grep', tool_input: { pattern: 'p', path: '/q' }, model: 'm' },
      { hook_event_name: 'PostToolUse', session_id: 's', cwd: worktree, tool_name: 'Bash', tool_input: { command: `echo ${'z'.repeat(300)}\nSECRET` } },
      { hook_event_name: 'Notification', session_id: 's', cwd: join(worktree, 'src'), message: 'needs permission' },
      { hook_event_name: 'PreCompact', session_id: 's', cwd: repo },
      { hook_event_name: 'SubagentStop', session_id: 's', cwd: repo, agent_id: 'a1' },
    ];
    const envs: Record<string, string>[] = [{}, { PIXELAGENTS_ACCOUNT: 'work', PIXELAGENTS_HOST: 'vm' }, { CLAUDE_CONFIG_DIR: '/h/.claude-acme/' }];
    for (const env of envs) {
      for (const p of [...payloads, ...extra]) {
        const dir = tmp();
        const r = runEmit(p, env, dir);
        expect(r.status).toBe(0);
        expect(r.stdout + r.stderr).toBe('');
        expect(r.lines).toHaveLength(1);
        const got = JSON.parse(r.lines[0]!);
        const want = buildHookLine(p, env, undefined, { now: () => got.ts, cwd: process.cwd() });
        expect(got).toEqual(want);
        expect(r.lines[0]).not.toContain('SECRET');
      }
    }
  });

  it('exits 0 and stays silent on garbage, empty input and an unwritable dir', () => {
    const dir = tmp();
    for (const input of ['', 'not json', '[]', '{"x":1}', 'null']) {
      const r = runEmit(null, {}, dir, input);
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).toBe('');
      expect(r.lines).toEqual([]);
    }
    const r = runEmit(payloads[0], {}, '/dev/null/nope');
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('creates the events dir on first use and appends', () => {
    const dir = join(tmp(), 'new', 'dir');
    runEmit(payloads[0], {}, dir);
    runEmit(payloads[1], {}, dir);
    expect(readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2);
  });
});
