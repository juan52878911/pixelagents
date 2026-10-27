#!/usr/bin/env node
// CLI entry: runs the compiled dist/cli.js (npm run build), else the TypeScript source through tsx.
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const root = join(__dirname, '..');
const dist = join(root, 'dist', 'cli.js');
const argv = process.argv.slice(2);
if (existsSync(dist)) {
  import(pathToFileURL(dist).href)
    .then((m) => m.main(argv))
    .then((c) => {
      process.exitCode = c;
    });
} else {
  const src = join(root, 'src', 'cli.ts');
  const code = `import(${JSON.stringify(pathToFileURL(src).href)}).then((m) => m.main(process.argv.slice(1))).then((c) => { process.exitCode = c; })`;
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', code, ...argv], { stdio: 'inherit' });
  process.exitCode = r.status === null ? 1 : r.status;
}
