// Starts the packaged server (packages/cli bundle) for the e2e tests: one `file` input over
// fixtures/claude-code.v1.jsonl read from the start. Temporary config and data dir; never ~/.pixelagents.
// usage: node test/e2e/serve.mjs [port=4391]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = process.argv[2] ?? '4391';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelagents-e2e-'));

const cfg = JSON.parse(fs.readFileSync(path.join(repo, 'fixtures', 'config.fixtures.json'), 'utf8').replaceAll('__REPO__', repo.replaceAll('\\', '/')));
cfg.inputs = [...cfg.inputs.filter((i) => i.id === 'fx'), { id: 'http', type: 'http', adapter: 'claude-code' }];
cfg.plugins = ['@pixelagents/plugin-claude-code', '@pixelagents/plugin-pop'];
const configPath = path.join(tmp, 'config.json');
fs.writeFileSync(configPath, JSON.stringify(cfg));

const child = spawn(process.execPath, [path.join(repo, 'packages', 'cli', 'bin', 'pixelagents.js'), 'serve', '--config', configPath, '--data-dir', path.join(tmp, 'data'), '--port', port], {
  stdio: 'inherit',
  env: { ...process.env, HOME: tmp, USERPROFILE: tmp },
});
const stop = () => {
  child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => {
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(code ?? 0);
});
