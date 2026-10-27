// Keeps the code blocks of docs/plugins.md equal to the tested files in examples/.
// A block is  <!-- snippet: path/from/repo/root -->  ```lang ... ```  <!-- /snippet -->.
// Usage: node scripts/embed-snippets.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'docs/plugins.md');
const LANG = { '.ts': 'ts', '.json': 'json', '.mjs': 'js', '.js': 'js' };
const src = readFileSync(file, 'utf8');
const next = src.replace(/<!-- snippet: (\S+) -->[\s\S]*?<!-- \/snippet -->/g, (_, p) => {
  const body = readFileSync(resolve(root, p), 'utf8').replace(/\n$/, '');
  return `<!-- snippet: ${p} -->\n\`\`\`${LANG[extname(p)] ?? ''}\n${body}\n\`\`\`\n<!-- /snippet -->`;
});
if (process.argv.includes('--check')) {
  if (next !== src) { console.error('docs/plugins.md snippets are stale: run node scripts/embed-snippets.mjs'); process.exit(1); }
} else {
  writeFileSync(file, next);
  console.log('docs/plugins.md snippets updated');
}
