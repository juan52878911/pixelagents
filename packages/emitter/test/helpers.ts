import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';

const made: string[] = [];
export function tmp(prefix = 'pa-test-'): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(d);
  return d;
}
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: 'ignore',
  });
}

/** A temp git repo named `name` on branch `branch`, plus a linked worktree on `wtBranch`. */
export function makeRepo(name = 'my-repo', branch = 'main', wtBranch = 'feature/x') {
  const root = tmp();
  const repo = join(root, name);
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', branch);
  writeFileSync(join(repo, 'a.txt'), 'a');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'init');
  const worktree = join(root, 'wt-elsewhere');
  git(repo, 'worktree', 'add', '-q', '-b', wtBranch, worktree);
  mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
  mkdirSync(join(worktree, 'src'), { recursive: true });
  return { root, repo, worktree };
}
