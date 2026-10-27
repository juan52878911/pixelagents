// pixelagents hooks|agent|service ... (the `serve` subcommand belongs to @pixelagents/server).
import { startAgent } from './agent.js';
import { hooksStatus, installHooks, uninstallHooks } from './hooks.js';
import { installService, renderService, uninstallService, type ServiceName } from './service.js';

const USAGE = `usage:
  pixelagents hooks install|uninstall|status [--config-dir DIR]... [--account NAME]
  pixelagents agent --hub URL --token T [--file PATH]... [--dir DIR]
  pixelagents service install|uninstall|print serve|agent [args...]`;

function flags(argv: string[], multi: string[], single: string[]): { rest: string[]; v: Record<string, string[]> } {
  const v: Record<string, string[]> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const name = a.startsWith('--') ? a.slice(2) : '';
    if (multi.includes(name) || single.includes(name)) {
      const val = argv[++i];
      if (val === undefined) throw new Error(`--${name} needs a value`);
      (v[name] ??= []).push(val);
      if (single.includes(name) && v[name]!.length > 1) throw new Error(`--${name} given twice`);
    } else rest.push(a);
  }
  return { rest, v };
}

export async function main(argv: string[], out: (s: string) => void = console.log): Promise<number> {
  const [cmd, sub, ...rest] = argv;
  try {
    if (cmd === 'hooks') {
      const { rest: extra, v } = flags(rest, ['config-dir'], ['account']);
      if (extra.length) throw new Error(`unexpected: ${extra.join(' ')}`);
      const dirs = v['config-dir'];
      if (sub === 'install') {
        for (const r of installHooks(dirs, { account: v.account?.[0] }))
          out(`${r.changed ? 'installed' : 'already installed'}: ${r.settingsPath}${r.backedUp ? ' (backup created)' : ''}`);
        return 0;
      }
      if (sub === 'uninstall') {
        for (const r of uninstallHooks(dirs)) out(`${r.changed ? 'removed' : 'nothing to remove'}: ${r.settingsPath}`);
        return 0;
      }
      if (sub === 'status') {
        for (const s of hooksStatus(dirs))
          out(
            `${s.installed ? 'installed' : s.events.length ? `partial (missing ${s.missing.join(',')})` : 'not installed'}: ${s.settingsPath}` +
              (s.account ? ` account=${s.account}` : '') +
              (s.emitterExists === false ? ` (emitter missing: ${s.emitterPath})` : ''),
          );
        return 0;
      }
    } else if (cmd === 'agent') {
      const { v } = flags([sub, ...rest].filter((x): x is string => x !== undefined), ['file'], ['hub', 'token', 'dir']);
      const hub = v.hub?.[0] ?? process.env.PIXELAGENTS_HUB;
      const token = v.token?.[0] ?? process.env.PIXELAGENTS_TOKEN;
      if (!hub || !token) throw new Error('agent needs --hub URL and --token T');
      const h = startAgent({ hub, token, files: v.file, dir: v.dir?.[0], log: (m) => console.error(`[agent] ${m}`) });
      const stop = () => void h.stop().then(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
      await new Promise(() => {}); // run until signalled
    } else if (cmd === 'service') {
      const [name, ...args] = rest;
      if ((sub === 'install' || sub === 'uninstall' || sub === 'print') && (name === 'serve' || name === 'agent')) {
        const spec = { name: name as ServiceName, args };
        if (sub === 'print') {
          const f = renderService(spec);
          out(`# ${f.path}\n${f.content}`);
        } else if (sub === 'install') {
          out(`installed ${installService(spec).path}`);
        } else {
          const r = uninstallService(spec);
          out(r.existed ? `removed ${r.path}` : `not installed: ${r.path}`);
        }
        return 0;
      }
    }
  } catch (e) {
    console.error(`pixelagents: ${(e as Error).message}`);
    return 1;
  }
  console.error(USAGE);
  return 2;
}

