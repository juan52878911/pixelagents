import { afterEach, describe, expect, it } from 'vitest';
import { ev, start, stopAll } from './helpers.js';

afterEach(stopAll);

describe('core reducer', () => {
  it('runs every transition', async () => {
    const c = await start(4300);
    const s = c.server;
    const get = (id: string) => s.snapshot().entities.find((e) => e.id === id)!;
    const A = 'agent:a';

    s.ingest(ev(c.clock, A, 'session.start', { model: 'opus' }, { labels: { host: 'mac', repo: 'x' } }));
    expect(get(A)).toMatchObject({ kind: 'agent', status: 'starting', labels: { host: 'mac', repo: 'x', model: 'opus' } });

    c.clock.advance(1);
    s.ingest(ev(c.clock, A, 'turn.start'));
    expect(get(A)).toMatchObject({ status: 'thinking', activity: { category: 'think' } });

    const cases: [string, string, string][] = [
      ['Read', 'read', 'a.ts'], ['Grep', 'read', 'x'], ['Glob', 'read', '*'], ['LS', 'read', '.'],
      ['Edit', 'edit', 'a.ts'], ['Write', 'edit', 'a.ts'], ['MultiEdit', 'edit', 'a.ts'], ['NotebookEdit', 'edit', 'n'],
      ['Bash', 'run', 'ls'], ['WebFetch', 'web', 'u'], ['WebSearch', 'web', 'q'], ['Task', 'talk', 't'], ['Agent', 'talk', 't'], ['Whatever', 'other', 'z'],
    ];
    for (const [tool, category, detail] of cases) {
      c.clock.advance(1);
      s.ingest(ev(c.clock, A, 'tool.pre', { tool, detail }));
      expect(get(A)).toMatchObject({ status: 'working', activity: { tool, detail, category, since: new Date(c.clock.t).toISOString() } });
    }
    // tool.post keeps status and activity
    s.ingest(ev(c.clock, A, 'tool.post', { tool: 'Whatever', ok: true }));
    expect(get(A)).toMatchObject({ status: 'working', activity: { tool: 'Whatever' } });

    s.ingest(ev(c.clock, A, 'waiting.permission', { tool: 'Bash' }));
    expect(get(A)).toMatchObject({ status: 'waiting', activity: { category: 'wait', tool: 'Bash' } });
    // the tool ran after the prompt: back to working
    s.ingest(ev(c.clock, A, 'tool.post', { tool: 'Bash', detail: 'ls' }));
    expect(get(A)).toMatchObject({ status: 'working', activity: { tool: 'Bash', category: 'run' } });
    s.ingest(ev(c.clock, A, 'waiting.human'));
    expect(get(A)).toMatchObject({ status: 'waiting', activity: { category: 'wait' } });

    s.ingest(ev(c.clock, A, 'metric', { cost_usd: 0.5, tokens: 100, note: 'ignored' }));
    s.ingest(ev(c.clock, A, 'metric', { cost_usd: 0.75 }));
    expect(get(A).metrics).toEqual({ cost_usd: 0.75, tokens: 100 });

    s.ingest(ev(c.clock, A, 'state', { status: 'frozen', reason: 'vm' }));
    expect(get(A).status).toBe('frozen');

    s.ingest(ev(c.clock, A, 'turn.end'));
    expect(get(A)).toMatchObject({ status: 'idle' });
    expect(get(A).activity).toBeUndefined();

    // heartbeat only moves lastSeen
    c.clock.advance(5);
    const before = structuredClone(get(A));
    s.ingest(ev(c.clock, A, 'heartbeat'));
    const after = get(A);
    expect(after.lastSeen).toBe(new Date(c.clock.t).toISOString());
    expect({ ...after, lastSeen: '' }).toEqual({ ...before, lastSeen: '' });

    s.ingest(ev(c.clock, A, 'session.end'));
    expect(get(A).status).toBe('ended');
  });

  it('fork.start creates the child with its parent; fork.end ends it', async () => {
    const c = await start(4300);
    const s = c.server;
    s.ingest(ev(c.clock, 'agent:p', 'session.start'));
    s.ingest(ev(c.clock, 'subagent:c', 'fork.start', undefined, { parent: 'agent:p', labels: { host: 'h' } }));
    let c1 = s.snapshot().entities.find((e) => e.id === 'subagent:c')!;
    expect(c1).toMatchObject({ kind: 'subagent', parent: 'agent:p', status: 'starting' });
    s.ingest(ev(c.clock, 'subagent:c', 'fork.end'));
    c1 = s.snapshot().entities.find((e) => e.id === 'subagent:c')!;
    expect(c1.status).toBe('ended');
  });

  it('keeps a readable history capped by timing.historyMax', async () => {
    const c = await start(4300, { timing: { historyMax: 3 } });
    for (let i = 0; i < 6; i++) c.server.ingest(ev(c.clock, 'agent:h', 'tool.pre', { tool: 'Edit', detail: `f${i}.ts` }));
    const h = c.server.snapshot().entities[0]!.history;
    expect(h.map((x) => x.summary)).toEqual(['Edit f3.ts', 'Edit f4.ts', 'Edit f5.ts']);
  });

  it('truncates details to 120 chars and drops malformed events', async () => {
    const c = await start(4300);
    c.server.ingest(ev(c.clock, 'agent:t', 'tool.pre', { tool: 'Bash', detail: 'x'.repeat(500) }));
    c.server.ingest({ ts: 'nope', source: 's', entity: '', kind: 'tool.pre' });
    const snap = c.server.snapshot();
    expect(snap.entities).toHaveLength(1);
    expect(snap.entities[0]!.activity!.detail).toHaveLength(120);
  });
});

describe('timers', () => {
  it('sleeps idle entities, lingers ended ones and forgets silent ones', async () => {
    const c = await start(4301, { timing: { sleepAfterSec: 10, endedLingerSec: 5, forgetAfterSec: 60, historyMax: 20 } });
    const s = c.server;
    const status = (id: string) => s.snapshot().entities.find((e) => e.id === id)?.status;
    s.ingest(ev(c.clock, 'agent:idle', 'turn.end'));
    s.ingest(ev(c.clock, 'agent:busy', 'tool.pre', { tool: 'Edit' }));
    s.ingest(ev(c.clock, 'agent:gone', 'session.end'));

    c.clock.advance(4);
    s.tick();
    expect(status('agent:idle')).toBe('idle');
    expect(status('agent:gone')).toBe('ended');

    c.clock.advance(2); // 6 s: ended lingered > 5
    s.tick();
    expect(status('agent:gone')).toBeUndefined();

    c.clock.advance(5); // 11 s: idle > 10
    s.tick();
    expect(status('agent:idle')).toBe('sleeping');
    expect(status('agent:busy')).toBe('working'); // only idle sleeps

    c.clock.advance(60); // > forget
    s.tick();
    expect(s.snapshot().entities).toHaveLength(0);
    expect(s.snapshot().groups).toHaveLength(0);
  });

  it('wakes a sleeping entity on the next event', async () => {
    const c = await start(4301, { timing: { sleepAfterSec: 10, endedLingerSec: 5, forgetAfterSec: 600, historyMax: 20 } });
    c.server.ingest(ev(c.clock, 'agent:z', 'turn.end'));
    c.clock.advance(11);
    c.server.tick();
    expect(c.server.snapshot().entities[0]!.status).toBe('sleeping');
    c.server.ingest(ev(c.clock, 'agent:z', 'turn.start'));
    expect(c.server.snapshot().entities[0]!.status).toBe('thinking');
  });
});

describe('classification and groups', () => {
  it('applies rules, groups by template, kinds by glob, aggregates metrics', async () => {
    const c = await start(4301, {
      classify: [
        { name: 'skin', match: { 'labels.account': 'work' }, set: { 'view.skin': 'work', 'labels.team': 'blue' } },
        { name: 'explicit group', match: { 'labels.repo': 'special' }, set: { 'view.group': 'lab-{{labels.host}}' } },
        { name: 'minion', match: { kind: 'subagent' }, set: { 'view.behavior': 'minion' } },
      ],
    });
    const s = c.server;
    s.ingest(ev(c.clock, 'agent:1', 'tool.pre', { tool: 'Edit' }, { labels: { host: 'mac', account: 'work', repo: 'a' } }));
    s.ingest(ev(c.clock, 'agent:1', 'metric', { cost_usd: 1.25 }));
    s.ingest(ev(c.clock, 'agent:2', 'waiting.permission', undefined, { labels: { host: 'mac', account: 'home', repo: 'a' } }));
    s.ingest(ev(c.clock, 'agent:2', 'metric', { cost_usd: 0.5 }));
    s.ingest(ev(c.clock, 'agent:3', 'turn.start', undefined, { labels: { host: 'pc', repo: 'special' } }));
    s.ingest(ev(c.clock, 'subagent:4', 'fork.start', undefined, { parent: 'agent:1', labels: { host: 'mac' } }));

    const snap = s.snapshot();
    const e = (id: string) => snap.entities.find((x) => x.id === id)!;
    expect(e('agent:1').view).toMatchObject({ skin: 'work', group: 'mac' });
    expect(e('agent:1').labels.team).toBe('blue');
    expect(e('agent:2').view.skin).toBeUndefined();
    expect(e('agent:3').view.group).toBe('lab-pc');
    expect(e('subagent:4').view.behavior).toBe('minion');

    const g = (id: string) => snap.groups.find((x) => x.id === id)!;
    expect(g('mac')).toMatchObject({ kind: 'office', label: 'Office mac', labels: { host: 'mac' } });
    expect(g('mac').metrics).toEqual({ agents: 3, working: 1, waiting: 1, cost_usd: 1.75 });
    expect(g('lab-pc')).toMatchObject({ kind: 'lab', label: 'Office pc' });
  });

  it('reclassifies everything when the config changes', async () => {
    const c = await start(4301);
    c.server.ingest(ev(c.clock, 'agent:1', 'turn.start', undefined, { labels: { host: 'mac', repo: 'r' } }));
    expect(c.server.snapshot().entities[0]!.view.group).toBe('mac');
    const next = structuredClone(c.server.config);
    next.groups.by = '{{labels.repo}}';
    const res = await c.server.applyConfig(next);
    expect(res.ok).toBe(true);
    const snap = c.server.snapshot();
    expect(snap.entities[0]!.view.group).toBe('r');
    expect(snap.groups.map((g) => g.id)).toEqual(['r']);
  });
});
