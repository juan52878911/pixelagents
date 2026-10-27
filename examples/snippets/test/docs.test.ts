import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILTER_SPECS } from '../../../plugins/effects/src/client/specs.js';

const root = resolve(__dirname, '../../..');
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });

describe('docs stay in sync', () => {
  it('docs/plugins.md snippets equal the tested files', () => {
    const r = run(process.execPath, ['scripts/embed-snippets.mjs', '--check']);
    expect(r.status, r.stderr).toBe(0);
  });
  it('docs/config.md tables equal CONFIG_SCHEMA', () => {
    const r = run('npx', ['tsx', 'scripts/gen-config-docs.mjs', '--check']);
    expect(r.status, r.stderr).toBe(0);
  }, 60_000);
  it('every effects filter and parameter is documented, with its default', () => {
    const doc = readFileSync(resolve(root, 'docs/plugins.md'), 'utf8');
    for (const s of Object.values(FILTER_SPECS)) {
      for (const [k, p] of Object.entries(s.params)) {
        const row = doc.split('\n').find((l) => l.startsWith(`| \`${s.name}\` | \`${k}\` |`));
        expect(row, `${s.name}.${k}`).toBeTruthy();
        const d = p.type === 'string' || p.type === 'color' ? `\`"${p.default}"\`` : p.type === 'colors' ? '`[]`' : p.type === 'boolean' ? `\`${p.default}\`` : ` ${p.default} `;
        expect(row, `${s.name}.${k} default`).toContain(d);
      }
    }
  });
});
