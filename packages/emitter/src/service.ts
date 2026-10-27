// `pixelagents service install|uninstall|print serve|agent [args]`: launchd plist (macOS) or systemd
// user unit (Linux/WSL). `print` only returns text. install/uninstall write the file and call the
// service manager through an injectable runner (tests never touch the real ones).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ServiceName = 'serve' | 'agent';
export type ServicePlatform = 'darwin' | 'linux';

export interface ServiceSpec {
  name: ServiceName;
  /** Arguments after the subcommand, e.g. ['--hub','https://x','--token','T']. */
  args?: string[];
  platform?: ServicePlatform;
  node?: string;
  /** Entry point running the subcommand (default: this package's bin/pixelagents.js). */
  bin?: string;
  home?: string;
  logDir?: string;
  /** Extra environment for the service (e.g. PIXELAGENTS_DIR). */
  env?: Record<string, string>;
}

export interface ServiceFile {
  label: string;
  path: string;
  content: string;
  platform: ServicePlatform;
}

export function defaultBin(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'pixelagents.js');
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const systemdQuote = (s: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `"${s.replace(/(["\\])/g, '\\$1').replace(/%/g, '%%')}"`);

export function detectPlatform(p: string = process.platform): ServicePlatform {
  if (p === 'darwin') return 'darwin';
  if (p === 'linux') return 'linux';
  throw new Error(`unsupported platform for services: ${p}`);
}

export function renderService(spec: ServiceSpec): ServiceFile {
  if (spec.name !== 'serve' && spec.name !== 'agent') throw new Error('service name must be "serve" or "agent"');
  const platform = spec.platform ?? detectPlatform();
  const home = spec.home ?? homedir();
  const argv = [spec.node ?? process.execPath, spec.bin ?? defaultBin(), spec.name, ...(spec.args ?? [])];
  const env = spec.env ?? {};
  if (platform === 'darwin') {
    const label = `dev.pixelagents.${spec.name}`;
    const logDir = spec.logDir ?? join(home, 'Library', 'Logs', 'pixelagents');
    const envXml = Object.keys(env).length
      ? `  <key>EnvironmentVariables</key>\n  <dict>\n${Object.entries(env)
          .map(([k, v]) => `    <key>${xml(k)}</key>\n    <string>${xml(v)}</string>`)
          .join('\n')}\n  </dict>\n`
      : '';
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${argv.map((a) => `    <string>${xml(a)}</string>`).join('\n')}
  </array>
${envXml}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(join(logDir, `${spec.name}.log`))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logDir, `${spec.name}.log`))}</string>
</dict>
</plist>
`;
    return { label, platform, content, path: join(home, 'Library', 'LaunchAgents', `${label}.plist`) };
  }
  const label = `pixelagents-${spec.name}`;
  const content = `[Unit]
Description=pixelagents ${spec.name}
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${argv.map(systemdQuote).join(' ')}
${Object.entries(env)
  .map(([k, v]) => `Environment=${systemdQuote(`${k}=${v}`)}`)
  .join('\n')}${Object.keys(env).length ? '\n' : ''}Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;
  return { label, platform, content, path: join(home, '.config', 'systemd', 'user', `${label}.service`) };
}

export type Runner = (cmd: string, args: string[]) => void;
const realRunner: Runner = (cmd, args) => {
  execFileSync(cmd, args, { stdio: 'inherit' });
};

export interface ServiceOps {
  /** Writes the service file and loads it. `run` defaults to launchctl/systemctl. */
  run?: Runner;
  uid?: number;
}

export function installService(spec: ServiceSpec, ops: ServiceOps = {}): ServiceFile {
  const file = renderService(spec);
  const run = ops.run ?? realRunner;
  mkdirSync(dirname(file.path), { recursive: true });
  if (file.platform === 'darwin') {
    mkdirSync(spec.logDir ?? join(spec.home ?? homedir(), 'Library', 'Logs', 'pixelagents'), { recursive: true });
  }
  writeFileSync(file.path, file.content);
  if (file.platform === 'darwin') {
    const dom = `gui/${ops.uid ?? process.getuid?.() ?? 501}`;
    try {
      run('launchctl', ['bootout', dom, file.path]); // reload if already loaded
    } catch {
      /* not loaded yet */
    }
    run('launchctl', ['bootstrap', dom, file.path]);
  } else {
    run('systemctl', ['--user', 'daemon-reload']);
    run('systemctl', ['--user', 'enable', '--now', `${file.label}.service`]);
  }
  return file;
}

export function uninstallService(spec: Pick<ServiceSpec, 'name' | 'platform' | 'home'>, ops: ServiceOps = {}): ServiceFile & { existed: boolean } {
  const file = renderService(spec);
  const run = ops.run ?? realRunner;
  const existed = existsSync(file.path);
  if (existed) {
    if (file.platform === 'darwin') {
      run('launchctl', ['bootout', `gui/${ops.uid ?? process.getuid?.() ?? 501}`, file.path]);
    } else {
      run('systemctl', ['--user', 'disable', '--now', `${file.label}.service`]);
    }
    rmSync(file.path);
    if (file.platform === 'linux') run('systemctl', ['--user', 'daemon-reload']);
  }
  return { ...file, existed };
}
