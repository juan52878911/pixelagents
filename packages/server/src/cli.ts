#!/usr/bin/env node
// `pixelagents serve [--config path] [--port n] [--host h] [--web path] [--data-dir path]`
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, type PaConfig } from '@pixelagents/protocol';
import { createServer } from './server.js';
import { expandHome } from './util.js';

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = { _: '' };
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) out[a.slice(2)] = argv[++i]!;
      else out[a.slice(2)] = true;
    } else rest.push(a);
  }
  out._ = rest.join(' ');
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cmd = String(args._ || 'serve').split(' ')[0];
  if (args.help || args.h || (cmd !== 'serve' && cmd !== '')) {
    console.error('usage: pixelagents serve [--config path] [--port n] [--host h] [--web path] [--data-dir path]');
    process.exit(args.help || args.h ? 0 : 2);
  }
  const str = (k: string): string | undefined => (typeof args[k] === 'string' ? (args[k] as string) : undefined);

  const configPath = path.resolve(expandHome(str('config') ?? path.join(os.homedir(), '.pixelagents', 'config.json')));
  let user: PaConfig;
  if (fs.existsSync(configPath)) {
    const file = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<PaConfig>;
    user = { ...DEFAULT_CONFIG, ...file, server: { ...DEFAULT_CONFIG.server, ...file.server } };
  } else {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    console.error(`[pixelagents] created ${configPath} from the default config`);
    user = structuredClone(DEFAULT_CONFIG);
  }

  let webRoot = str('web');
  if (!webRoot) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dist = path.resolve(here, '../../web/dist');
    if (fs.existsSync(dist)) webRoot = dist;
  }

  const server = createServer(user, {
    configPath,
    webRoot,
    dataDir: str('data-dir'),
    port: str('port') ? Number(str('port')) : undefined,
    host: str('host'),
  });
  const port = await server.listen();
  console.error(`[pixelagents] listening on http://${str('host') ?? user.server.host}:${port}  (config ${configPath}, data ${server.dataDir})`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => {
  console.error(`[pixelagents] ${(e as Error).message}`);
  process.exit(1);
});
