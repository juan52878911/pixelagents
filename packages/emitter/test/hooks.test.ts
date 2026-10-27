import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMIT_MARKER, HOOK_EVENTS, hooksStatus, installHooks, uninstallHooks } from '../src/index.js';
import { main } from '../src/cli.js';
import { tmp } from './helpers.js';

const emitterPath = new URL('../bin/emit.js', import.meta.url).pathname;
const original = {
  permissions: { allow: ['Bash(ls)'] },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
};
const read = (d: string) => JSON.parse(readFileSync(join(d, 'settings.json'), 'utf8'));

function setup(settings?: unknown) {
  const d = tmp();
  if (settings !== undefined) writeFileSync(join(d, 'settings.json'), JSON.stringify(settings, null, 2));
  return d;
}

describe('hooks install/uninstall/status', () => {
  it('installs idempotently, keeps foreign hooks, backs up once', () => {
    const d = setup(original);
    const [r1] = installHooks(d, { emitterPath });
    expect(r1).toMatchObject({ changed: true, backedUp: true });
    const once = readFileSync(join(d, 'settings.json'), 'utf8');
    const [r2] = installHooks(d, { emitterPath });
    expect(r2).toMatchObject({ changed: false, backedUp: false });
    expect(readFileSync(join(d, 'settings.json'), 'utf8')).toBe(once);

    const s = read(d);
    expect(s.permissions).toEqual(original.permissions);
    for (const ev of HOOK_EVENTS) expect(s.hooks[ev].filter((e: any) => e.hooks[0].command.includes(EMIT_MARKER))).toHaveLength(1);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe('echo mine');
    expect(s.hooks.PreToolUse[1].matcher).toBe('*');
    expect(s.hooks.Stop[0].hooks[0].command).toBe('say done');
    expect(s.hooks.SessionStart[0].hooks[0].command).toContain(JSON.stringify(emitterPath));

    // the backup is the pristine original and is never overwritten
    expect(JSON.parse(readFileSync(join(d, 'settings.json.pixelagents-backup'), 'utf8'))).toEqual(original);
    installHooks(d, { emitterPath, account: 'work' });
    expect(JSON.parse(readFileSync(join(d, 'settings.json.pixelagents-backup'), 'utf8'))).toEqual(original);
  });

  it('uninstall restores the foreign hooks exactly and is idempotent', () => {
    const d = setup(original);
    installHooks(d, { emitterPath });
    const [u1] = uninstallHooks(d);
    expect(u1!.changed).toBe(true);
    expect(read(d)).toEqual(original);
    expect(uninstallHooks(d)[0]!.changed).toBe(false);
    expect(uninstallHooks(tmp())[0]!.changed).toBe(false); // no settings file at all
  });

  it('works from nothing and removes the empty hooks section', () => {
    const d = tmp();
    installHooks(d, { emitterPath });
    expect(existsSync(join(d, 'settings.json.pixelagents-backup'))).toBe(false);
    uninstallHooks(d);
    expect(read(d)).toEqual({});
  });

  it('several config dirs, one account each', () => {
    const a = setup({});
    const b = setup({});
    installHooks([a], { emitterPath, account: 'personal' });
    installHooks([b], { emitterPath, account: 'work' });
    expect(read(a).hooks.Stop[0].hooks[0].command).toMatch(/^PIXELAGENTS_ACCOUNT=personal node /);
    expect(read(b).hooks.Stop[0].hooks[0].command).toMatch(/^PIXELAGENTS_ACCOUNT=work node /);
    const res = installHooks([a, b], { emitterPath, account: 'both' });
    expect(res.map((r) => r.changed)).toEqual([true, true]);
    expect(hooksStatus([a, b]).map((s) => [s.installed, s.account, s.emitterExists])).toEqual([
      [true, 'both', true],
      [true, 'both', true],
    ]);
    uninstallHooks([a, b]);
    expect(hooksStatus([a, b]).map((s) => s.installed)).toEqual([false, false]);
  });

  it('status reports partial installs', () => {
    const d = setup({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `node x #${EMIT_MARKER}` }] }] } });
    const [s] = hooksStatus(d);
    expect(s).toMatchObject({ installed: false, events: ['Stop'] });
    expect(s!.missing).toHaveLength(HOOK_EVENTS.length - 1);
  });

  it('refuses to rewrite an unparseable settings.json and a bad account', () => {
    const d = tmp();
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'settings.json'), '{ // comment\n}');
    expect(() => installHooks(d, { emitterPath })).toThrow(/not valid JSON/);
    expect(readFileSync(join(d, 'settings.json'), 'utf8')).toBe('{ // comment\n}');
    expect(existsSync(join(d, 'settings.json.pixelagents-backup'))).toBe(false);
    expect(() => installHooks(setup({}), { emitterPath, account: 'a b; rm -rf /' })).toThrow(/invalid account/);
  });

  it('CLI: install / status / uninstall with --config-dir and --account', async () => {
    const a = setup({});
    const b = setup({});
    const out: string[] = [];
    const run = (...args: string[]) => main(args, (s) => out.push(s));
    expect(await run('hooks', 'install', '--config-dir', a, '--config-dir', b, '--account', 'acme')).toBe(0);
    expect(read(b).hooks.Stop[0].hooks[0].command).toContain('PIXELAGENTS_ACCOUNT=acme');
    expect(await run('hooks', 'status', '--config-dir', a, '--config-dir', b)).toBe(0);
    expect(out.filter((l) => l.startsWith('installed:') && l.includes('account=acme'))).toHaveLength(2);
    expect(await run('hooks', 'uninstall', '--config-dir', a, '--config-dir', b)).toBe(0);
    expect(read(a)).toEqual({});
    expect(await run('hooks', 'bogus')).toBe(2);
  });
});
