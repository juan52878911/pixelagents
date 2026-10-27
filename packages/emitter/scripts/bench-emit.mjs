// 100 invocations of bin/emit.js with a PreToolUse payload; prints p50/p95/max in ms. Uses a temp dir.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const emit = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'emit.js');
const dir = mkdtempSync(join(tmpdir(), 'pa-bench-'));
const payload = JSON.stringify({
  hook_event_name: 'PreToolUse',
  session_id: 'bench',
  cwd: process.cwd(),
  tool_name: 'Edit',
  tool_input: { file_path: join(process.cwd(), 'src/app.ts'), old_string: 'x', new_string: 'y' },
});
const env = { ...process.env, PIXELAGENTS_DIR: dir };
const times = [];
for (let i = 0; i < 105; i++) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [emit], { input: payload, env });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.status !== 0) throw new Error('emit.js exited ' + r.status);
  if (i >= 5) times.push(ms); // 5 warm-up runs, 100 measured
}
rmSync(dir, { recursive: true, force: true });
times.sort((a, b) => a - b);
const p = (q) => times[Math.min(times.length - 1, Math.ceil(q * times.length) - 1)].toFixed(1);
console.log(`n=${times.length} p50=${p(0.5)}ms p95=${p(0.95)}ms max=${times.at(-1).toFixed(1)}ms`);
if (Number(p(0.95)) >= 30) {
  console.error('FAIL: p95 >= 30 ms');
  process.exit(1);
}
