#!/usr/bin/env node
// Writes deterministic synthetic fixtures that mirror the shape of each real source.
// No real data: hosts, users, repos and paths are invented. Run: node scripts/gen-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
mkdirSync(out, { recursive: true });
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const T0 = Date.parse('2026-01-15T09:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

const TOOLS = [
  ['Read', () => pick(['src/app.ts', 'README.md', 'src/api/user.ts', 'package.json'])],
  ['Edit', () => pick(['src/app.ts', 'src/ui/button.tsx', 'test/app.test.ts'])],
  ['Bash', () => pick(['npm test', 'git status', 'npm run build', 'ls src'])],
  ['Grep', () => pick(['TODO', 'export function', 'useState'])],
  ['WebFetch', () => 'https://example.com/docs'],
];
const AGENTS = [
  { session: 's-laptop-1', account: 'personal', host: 'laptop', repo: 'web-app', cwd: '/home/dev/code/web-app' },
  { session: 's-laptop-2', account: 'work', host: 'laptop', repo: 'api', cwd: '/home/dev/code/api' },
  { session: 's-ws-1', account: 'work', host: 'workstation', repo: 'api', cwd: '/home/dev/code/api' },
  { session: 's-vm-1', account: 'personal', host: 'vm-1', repo: 'shop-app', cwd: '/home/dev/code/shop-app' },
];

// 1. Claude Code hook lines, v1 wire format (packages/protocol HookLine) and the legacy format of the original project.
const v1 = [];
const legacy = [];
for (const a of AGENTS) {
  let t = T0 + Math.floor(rnd() * 60000);
  const base = { v: 1, session: a.session, agent: 'dev', account: a.account, host: a.host, cwd: a.cwd, repo: a.repo, branch: 'main' };
  const push = (kind, extra = {}) => {
    t += 500 + Math.floor(rnd() * 4000);
    v1.push({ ...base, ts: iso(t), kind, ...extra });
    const { v, account, host, branch, ...rest } = { ...base, ts: iso(t), kind, ...extra };
    legacy.push({ ...rest, source: 'claude-code', account, host });
  };
  push('session.start', { model: 'claude-sonnet' });
  for (let turn = 0; turn < 3; turn++) {
    push('turn.start');
    const n = 3 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const [tool, detail] = pick(TOOLS);
      push('tool.pre', { tool, detail: detail() });
      if (rnd() < 0.08) push('waiting.permission');
      if (tool === 'Bash' && rnd() < 0.3) {
        const sub = `${a.session}-sub${turn}`;
        v1.push({ ...base, session: sub, parent: a.session, ts: iso(t + 10), kind: 'fork.start' });
        v1.push({ ...base, session: sub, parent: a.session, ts: iso(t + 2000), kind: 'fork.end' });
      }
      push('tool.post', { tool });
    }
    push('turn.end');
  }
  if (rnd() < 0.6) push('session.end');
}
const byTs = (x, y) => (x.ts < y.ts ? -1 : 1);
writeFileSync(join(out, 'claude-code.v1.jsonl'), v1.sort(byTs).map((e) => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(join(out, 'claude-code.legacy.jsonl'), legacy.sort(byTs).map((e) => JSON.stringify(e)).join('\n') + '\n');

// 2. Raw Claude Code hook payloads (stdin of the emitter), one per hook.
const hooks = [
  { hook_event_name: 'SessionStart', session_id: 'abc', cwd: '/home/dev/code/web-app', source: 'startup' },
  { hook_event_name: 'UserPromptSubmit', session_id: 'abc', cwd: '/home/dev/code/web-app', prompt: 'SECRET PROMPT MUST NOT LEAK' },
  { hook_event_name: 'PreToolUse', session_id: 'abc', cwd: '/home/dev/code/web-app', tool_name: 'Edit', tool_input: { file_path: '/home/dev/code/web-app/src/app.ts', old_string: 'SECRET', new_string: 'SECRET' } },
  { hook_event_name: 'PreToolUse', session_id: 'abc', cwd: '/home/dev/code/web-app', tool_name: 'Bash', tool_input: { command: 'npm test -- --run' } },
  { hook_event_name: 'PostToolUse', session_id: 'abc', cwd: '/home/dev/code/web-app', tool_name: 'Bash', tool_response: { stdout: 'SECRET OUTPUT' } },
  { hook_event_name: 'Notification', session_id: 'abc', cwd: '/home/dev/code/web-app', message: 'Claude needs your permission to use Bash' },
  { hook_event_name: 'SubagentStart', session_id: 'abc', cwd: '/home/dev/code/web-app', agent_id: 'sub-1' },
  { hook_event_name: 'SubagentStop', session_id: 'abc', cwd: '/home/dev/code/web-app', agent_id: 'sub-1' },
  { hook_event_name: 'Stop', session_id: 'abc', cwd: '/home/dev/code/web-app' },
  { hook_event_name: 'SessionEnd', session_id: 'abc', cwd: '/home/dev/code/web-app', reason: 'exit' },
];
writeFileSync(join(out, 'hook-payloads.json'), JSON.stringify(hooks, null, 2) + '\n');

// 3. nod events.jsonl: envelopes {nod, source, events[]}. Text fields (prompt/answer) exist and must be ignored.
const nod = [];
for (const a of AGENTS.slice(0, 3)) {
  let ms = T0, seq = 0, cost = 0;
  const source = { instance: `i-${a.session}`, run: 'r1', host: 'claude-code', profile: a.account === 'personal' ? 'claude' : a.account, privacy: 'standard', host_version: '2.1.0', machine: a.host };
  const ev = (type, data, extra = {}) => ({ ts: (ms += 700 + Math.floor(rnd() * 3000)), type, session: a.session, data, seq: seq++, ...extra });
  const events = [ev('session.start', { interactive: true, cwd: a.cwd, repo: { root: a.cwd, remote: `git@example.com:dev/${a.repo}.git`, branch: 'main' }, model: 'claude-sonnet' })];
  for (let turn = 0; turn < 2; turn++) {
    const tid = `t${turn}`;
    events.push(ev('prompt.submit', { origin: 'user', chars: 42, text: 'SECRET PROMPT MUST NOT LEAK' }));
    events.push(ev('turn.start', {}, { turn: tid }));
    for (let i = 0; i < 3; i++) {
      const [tool, detail] = pick(TOOLS), id = `tu-${turn}-${i}`;
      events.push(ev('tool.call', { tool_use_id: id, tool, input: { message: detail() } }, { turn: tid, agent: 'main' }));
      if (rnd() < 0.4) {
        events.push(ev('permission.request', { tool_use_id: id, tool, reason: 'ask', check_ms: 3 }, { turn: tid, agent: 'main' }));
        events.push(ev('permission.decision', { tool_use_id: id, tool, decision: 'allow', by: 'user', wait_ms: 2400, exact: true }, { turn: tid, agent: 'main' }));
      }
      events.push(ev('tool.result', { tool_use_id: id, tool, duration_ms: 120, ok: true, rejected: false, output_chars: 900 }, { turn: tid, agent: 'main' }));
    }
    if (turn === 1) events.push(ev('agent.spawn', { agent: 'sub-a', type: 'Explore', background: false, fork: false, permission_mode: 'auto', description: 'look around', model: 'claude-haiku', tool_use_id: 'tu-x' }, { turn: tid, agent: 'main' }));
    if (turn === 1) events.push(ev('agent.end', { agent: 'sub-a', duration_ms: 9000, usage: { input: 10, output: 20, cache_read: 0, cache_write: 0, model: 'claude-haiku' } }, { agent: 'sub-a' }));
    events.push(ev('turn.step', { index: 0, tools: ['Read'], usage: { input: 100, output: 50, cache_read: 900, cache_write: 10, model: 'claude-sonnet' }, model: 'claude-sonnet', effort: 'medium', stop_reason: 'end_turn' }, { turn: tid, agent: 'main' }));
    events.push(ev('turn.end', { outcome: 'done', usage: { input: 100, output: 50, cache_read: 900, cache_write: 10, model: 'claude-sonnet' }, steps: 3, answer_chars: 120, duration_ms: 9000, answer: 'SECRET ANSWER MUST NOT LEAK' }, { turn: tid, agent: 'main' }));
    cost += 0.37 + rnd();
    events.push(ev('usage', { context: { tokens: 42000, window: 200000, percent: 21 }, limits: [{ kind: 'five_hour', percent: 33, resets_at: '2026-01-15T14:00:00Z' }, { kind: 'seven_day', percent: 7, resets_at: '2026-01-20T05:00:00Z' }], cost_usd: Number(cost.toFixed(4)) }));
  }
  // nod batches events per envelope
  for (let i = 0; i < events.length; i += 4) nod.push({ nod: 1, source, events: events.slice(i, i + 4) });
}
writeFileSync(join(out, 'nod.events.jsonl'), nod.map((e) => JSON.stringify(e)).join('\n') + '\n');

// 4. kindling: `kling ps -a -json` and `kling events -json`.
const states = ['running', 'running', 'warm', 'stopped', 'failed', 'created'];
const machines = states.map((state, i) => ({
  id: (0x1000 + i).toString(16).padStart(16, '0'), name: i < 4 ? `delega-2026011${i}-0900-${100 + i}` : `sandbox-${i}`, image: 'node22', state,
  vcpus: 4, mem_mib: 4096, pid: state === 'running' ? 1000 + i : 0, disk_mib: 16384, disk_bytes: 3.6e9, created_at: iso(T0 - 3600e3), started_at: iso(T0 - 1800e3),
  ...(state === 'warm' ? { frozen_at: iso(T0 - 60e3) } : {}), ...(state === 'failed' ? { last_error: 'guest agent did not answer' } : {}),
  ip: `10.0.0.${10 + i}`, net_index: i, egress: 'allowlist', cpu_pct: state === 'running' ? 120 + i * 30 : 0, labels: { owner: i % 2 ? 'work' : 'personal' }, boot_ms: 480,
}));
writeFileSync(join(out, 'kling.ps.json'), JSON.stringify(machines) + '\n');
const kev = [];
let kt = T0;
for (const m of machines.slice(0, 5)) {
  kev.push({ time: iso((kt += 1500)), type: 'machine.created', id: m.id, name: m.name, message: '' });
  kev.push({ time: iso((kt += 900)), type: 'machine.started', id: m.id, name: m.name, message: '' });
  if (m.state === 'warm') kev.push({ time: iso((kt += 4000)), type: 'machine.frozen', id: m.id, name: m.name, message: '' });
  if (m.state === 'stopped') kev.push({ time: iso((kt += 4000)), type: 'machine.stopped', id: m.id, name: m.name, message: 'exit 0' });
  if (m.state === 'failed') kev.push({ time: iso((kt += 4000)), type: 'machine.failed', id: m.id, name: m.name, message: m.last_error });
}
kev.push({ time: iso((kt += 1000)), type: 'machine.thawed', id: machines[2].id, name: machines[2].name, message: '' });
writeFileSync(join(out, 'kling.events.jsonl'), kev.map((e) => JSON.stringify(e)).join('\n') + '\n');

// 5. delega CLI text outputs (Spanish locale, the only one today).
writeFileSync(join(out, 'delega.quota.txt'), [
  '[personal] 5 h: 27 % (reinicia Mon 21:00, en 0.1 h) · semanal: 7 % (reinicia Mon 05:00, en 2 h) · dato de hace 33 min',
  'ritmo por trabajador: 12.0 %/h en 5 h, 1.60 %/h semanal (estimado, sin historial)',
  'tope por 5 h ≤70 %: 35 · por semanal ≤90 %: 25 · por huecos de las máquinas: 3',
  'CUPO: 3 trabajadores a la vez · vivos 1 · puedes lanzar 2 más',
  'gasto de hoy: 6.49 $ de 150.00 $', '',
].join('\n'));
writeFileSync(join(out, 'delega.spend.txt'), [
  'TOTAL day: 4 trabajos · 12.80 $ (precio de lista)',
  'presupuesto de hoy · work: 30.40 $ de 150.00 $',
  'presupuesto de hoy · personal: 6.49 $ de 150.00 $', '',
].join('\n'));

// 6. host load: `cat /proc/loadavg; nproc` and macOS `sysctl -n vm.loadavg hw.ncpu`.
writeFileSync(join(out, 'host.linux.txt'), '2.41 1.97 1.60 3/812 40211\n12\n');
writeFileSync(join(out, 'host.macos.txt'), '{ 3.12 2.80 2.55 }\n10\n');
console.log('fixtures written to', out);
