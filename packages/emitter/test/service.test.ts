import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installService, renderService, uninstallService } from '../src/index.js';
import { main } from '../src/cli.js';
import { tmp } from './helpers.js';

const common = { node: '/usr/bin/node', bin: '/opt/pa/bin/pixelagents.js', home: '/home/u' };

describe('service files', () => {
  it('launchd plist', () => {
    const f = renderService({ ...common, name: 'agent', platform: 'darwin', args: ['--hub', 'https://h?a=1&b=2', '--token', 'T'] });
    expect(f.path).toBe('/home/u/Library/LaunchAgents/dev.pixelagents.agent.plist');
    expect(f.content).toContain('<string>dev.pixelagents.agent</string>');
    expect(f.content).toContain('<string>/usr/bin/node</string>');
    expect(f.content).toContain('<string>https://h?a=1&amp;b=2</string>');
    expect(f.content).toContain('<key>KeepAlive</key>');
  });

  it('systemd user unit', () => {
    const f = renderService({ ...common, name: 'serve', platform: 'linux', args: ['--port', '4300'], env: { PIXELAGENTS_DIR: '/data dir' } });
    expect(f.path).toBe('/home/u/.config/systemd/user/pixelagents-serve.service');
    expect(f.content).toContain('ExecStart=/usr/bin/node /opt/pa/bin/pixelagents.js serve --port 4300');
    expect(f.content).toContain('Environment="PIXELAGENTS_DIR=/data dir"');
    expect(f.content).toContain('WantedBy=default.target');
  });

  it('install/uninstall write only under the given home and use the injected runner', () => {
    const home = tmp();
    const calls: string[] = [];
    const run = (c: string, a: string[]) => void calls.push([c, ...a].join(' '));
    const f = installService({ ...common, home, name: 'agent', platform: 'linux' }, { run });
    expect(f.path.startsWith(home)).toBe(true);
    expect(existsSync(f.path)).toBe(true);
    expect(calls).toEqual(['systemctl --user daemon-reload', 'systemctl --user enable --now pixelagents-agent.service', 'loginctl enable-linger']);
    expect(uninstallService({ home, name: 'agent', platform: 'linux' }, { run }).existed).toBe(true);
    expect(existsSync(f.path)).toBe(false);
    expect(uninstallService({ home, name: 'agent', platform: 'linux' }, { run }).existed).toBe(false);

    calls.length = 0;
    const m = installService({ ...common, home, name: 'serve', platform: 'darwin', logDir: join(home, 'logs') }, { run, uid: 501 });
    expect(readFileSync(m.path, 'utf8')).toContain('dev.pixelagents.serve');
    expect(calls.at(-1)).toBe(`launchctl bootstrap gui/501 ${m.path}`);
  });

  it('CLI print only prints', async () => {
    const out: string[] = [];
    expect(await main(['service', 'print', 'agent', '--hub', 'http://x', '--token', 'T'], (s) => out.push(s))).toBe(0);
    expect(out.join('\n')).toContain('--hub');
    expect(await main(['service', 'print', 'bogus'], () => {})).toBe(2);
  });
});
