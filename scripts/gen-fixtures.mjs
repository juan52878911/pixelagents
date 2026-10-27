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
  push('session.start', { model: 'claude-sonnet', source: 'startup', permissionMode: 'default' });
  for (let turn = 0; turn < 3; turn++) {
    push('turn.start');
    const n = 3 + Math.floor(rnd() * 6);
    let steps = 0;
    for (let i = 0; i < n; i++) {
      const [tool, detail] = pick(TOOLS);
      push('tool.pre', { tool, detail: detail(), effort: 'high' });
      if (rnd() < 0.08) push('waiting.permission');
      if ((tool === 'Bash' && rnd() < 0.3) || (turn === 2 && i === 0)) {
        const sub = `${a.session}-sub${turn}`;
        v1.push({ ...base, session: sub, parent: a.session, ts: iso(t + 10), kind: 'fork.start', agentType: 'Explore' });
        v1.push({ ...base, session: sub, parent: a.session, ts: iso(t + 2000), kind: 'fork.end', agentType: 'Explore', usage: { input: 50, output: 400, cache_read: 3000, cache_write: 0 }, steps: 2, contextTokens: 3050, usageModel: 'claude-haiku', turnMs: 1900 });
      }
      if (tool === 'Bash' && rnd() < 0.2) push('tool.post', { tool, ok: false, error: 'exit 1', durationMs: 300 });
      else push('tool.post', { tool, durationMs: 80 + Math.floor(rnd() * 900) });
      steps++;
    }
    if (turn === 1) push('compact', { source: 'auto' });
    push('turn.end', { usage: { input: 200 * steps, output: 150 * steps, cache_read: 12000, cache_write: 400 }, steps: steps + 1, contextTokens: 12600 + 200 * steps, usageModel: 'claude-sonnet', turnMs: 4000 * steps, effort: 'high' });
  }
  if (rnd() < 0.6) push('session.end', { reason: 'prompt_input_exit' });
}
// Legacy lines never carried the new fields.
for (const l of legacy) for (const k of ['permissionMode', 'effort', 'agentType', 'usage', 'steps', 'contextTokens', 'usageModel', 'turnMs', 'ok', 'error', 'durationMs', 'reason']) delete l[k];
const byTs = (x, y) => (x.ts < y.ts ? -1 : 1);
writeFileSync(join(out, 'claude-code.v1.jsonl'), v1.sort(byTs).map((e) => JSON.stringify(e)).join('\n') + '\n');
writeFileSync(join(out, 'claude-code.legacy.jsonl'), legacy.sort(byTs).map((e) => JSON.stringify(e)).join('\n') + '\n');

// 2. A Claude Code transcript (~/.claude/projects/<proj>/<session>.jsonl): two turns, tool results, an api
// error and a compaction boundary. Text fields carry SECRET: only usage numbers, models and timestamps may be read.
const tr = [];
let tt = T0;
const trLine = (type, extra) => tr.push({ parentUuid: tr.length ? `u${tr.length - 1}` : null, isSidechain: false, cwd: '/home/dev/code/web-app', sessionId: 'abc', version: '2.1.0', branch: 'main', type, uuid: `u${tr.length}`, timestamp: iso((tt += 1500)), ...extra });
const assistant = (content, usage, stop) => trLine('assistant', { message: { model: 'claude-sonnet', id: `msg_${tr.length}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage }, requestId: `req_${tr.length}`, effort: 'high' });
const usage = (i, o, cr, cw) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, service_tier: 'standard' });
trLine('user', { message: { role: 'user', content: 'SECRET PROMPT 1 MUST NOT LEAK' } });
assistant([{ type: 'text', text: 'SECRET ANSWER MUST NOT LEAK' }], usage(10, 20, 1000, 500), 'end_turn');
trLine('user', { message: { role: 'user', content: [{ type: 'text', text: 'SECRET PROMPT 2 MUST NOT LEAK' }] } });
assistant([{ type: 'thinking', thinking: 'SECRET THOUGHTS' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/home/dev/code/web-app/src/app.ts' } }], usage(30, 100, 1500, 20), 'tool_use');
trLine('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'SECRET FILE CONTENTS' }] }, toolUseResult: { type: 'text', file: { filePath: '/x', content: 'SECRET' } } });
trLine('system', { subtype: 'api_error', error: { status: 529 }, retryAttempt: 1, retryInMs: 500, level: 'warning' });
assistant([{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'npm test' } }], usage(40, 60, 1520, 30), 'tool_use');
trLine('user', { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'SECRET OUTPUT', is_error: true }] } });
trLine('system', { subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 180000 }, content: 'SECRET SUMMARY', level: 'info' });
assistant([{ type: 'text', text: 'SECRET FINAL ANSWER' }], usage(50, 300, 1550, 40), 'end_turn');
writeFileSync(join(out, 'transcript.jsonl'), tr.map((e) => JSON.stringify(e)).join('\n') + '\n');

// 3. Raw Claude Code hook payloads (stdin of the emitter), one per hook. transcript_path is relative to the repo.
const common = { session_id: 'abc', cwd: '/home/dev/code/web-app', transcript_path: 'fixtures/transcript.jsonl', permission_mode: 'default' };
const hooks = [
  { hook_event_name: 'SessionStart', ...common, source: 'startup', model: 'claude-sonnet' },
  { hook_event_name: 'SessionStart', ...common, source: 'resume', seconds_since_last_response: 120, context_tokens: 42000 },
  { hook_event_name: 'UserPromptSubmit', ...common, prompt: 'SECRET PROMPT MUST NOT LEAK' },
  { hook_event_name: 'PreToolUse', ...common, tool_name: 'Edit', tool_use_id: 'toolu_1', effort: { level: 'high' }, tool_input: { file_path: '/home/dev/code/web-app/src/app.ts', old_string: 'SECRET', new_string: 'SECRET' } },
  { hook_event_name: 'PreToolUse', ...common, tool_name: 'Bash', tool_use_id: 'toolu_2', tool_input: { command: 'npm test -- --run' } },
  { hook_event_name: 'PostToolUse', ...common, tool_name: 'Bash', tool_use_id: 'toolu_2', duration_ms: 1234, tool_input: { command: 'npm test -- --run' }, tool_response: { stdout: 'SECRET OUTPUT' } },
  { hook_event_name: 'PostToolUseFailure', ...common, tool_name: 'Bash', tool_use_id: 'toolu_3', duration_ms: 50, tool_input: { command: 'false' }, error: 'Exit code 1\nSECRET ERROR OUTPUT' },
  { hook_event_name: 'PostToolUseFailure', ...common, tool_name: 'Read', tool_use_id: 'toolu_4', is_interrupt: true, tool_input: { file_path: '/x' }, error: 'SECRET interrupted' },
  { hook_event_name: 'Notification', ...common, message: 'Claude needs your permission to use Bash' },
  { hook_event_name: 'Notification', ...common, notification_type: 'permission_prompt', message: 'SECRET: permission to run SECRET', title: 'Permission' },
  { hook_event_name: 'Notification', ...common, notification_type: 'idle_prompt', message: 'Claude is waiting for your input' },
  { hook_event_name: 'Notification', ...common, notification_type: 'auth_success', message: 'SECRET token' },
  { hook_event_name: 'SubagentStart', ...common, agent_id: 'sub-1', agent_type: 'Explore' },
  { hook_event_name: 'SubagentStop', ...common, agent_id: 'sub-1', agent_type: 'Explore', agent_transcript_path: 'fixtures/transcript.jsonl', last_assistant_message: 'SECRET SUBAGENT REPORT' },
  { hook_event_name: 'Stop', ...common, stop_hook_active: false, effort: { level: 'high' }, last_assistant_message: 'SECRET ANSWER MUST NOT LEAK' },
  { hook_event_name: 'PreCompact', ...common, trigger: 'auto', custom_instructions: 'SECRET INSTRUCTIONS' },
  { hook_event_name: 'SessionEnd', ...common, reason: 'prompt_input_exit' },
];
writeFileSync(join(out, 'hook-payloads.json'), JSON.stringify(hooks, null, 2) + '\n');

// 4. nod events.jsonl: envelopes {nod, source, events[]}. Text fields (prompt/answer) exist and must be ignored.
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
  if (a.session === 's-ws-1') events.push(ev('session.end', { duration_ms: 60000, reason: 'exit' }));
  // nod batches events per envelope
  for (let i = 0; i < events.length; i += 4) nod.push({ nod: 1, source, events: events.slice(i, i + 4) });
}
writeFileSync(join(out, 'nod.events.jsonl'), nod.map((e) => JSON.stringify(e)).join('\n') + '\n');

// 5. kindling: `kling ps -a -json` and `kling events -json`.
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

// 6. delega CLI text outputs (Spanish locale, the only one today).
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

// 7. host load: `cat /proc/loadavg; nproc` and macOS `sysctl -n vm.loadavg hw.ncpu`.
writeFileSync(join(out, 'host.linux.txt'), '2.41 1.97 1.60 3/812 40211\n12\n');
writeFileSync(join(out, 'host.macos.txt'), '{ 3.12 2.80 2.55 }\n10\n');
console.log('fixtures written to', out);
