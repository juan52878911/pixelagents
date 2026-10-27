import { describe, expect, it } from 'vitest';
import { mapAdapter } from '../src/index.js';

const ctx = (options: Record<string, unknown>) => ({ input: 'm', options, now: () => new Date('2026-01-15T10:00:00Z') });

describe('map adapter', () => {
  it('config 1: templates for entity, kind, labels and typed attrs', () => {
    const [e, ...rest] = mapAdapter.parse(
      { svc: 'api', env: 'prod', cpu: 73, at: '2026-02-01T00:00:00Z' },
      ctx({ entity: 'svc:{{svc}}', kind: 'metric', labels: { env: '{{env}}', team: '{{missing}}' }, attrs: { cpu_pct: '{{cpu}}' }, ts: '{{at}}' }),
    );
    expect(rest).toEqual([]);
    expect(e).toEqual({
      ts: '2026-02-01T00:00:00.000Z',
      source: 'm',
      entity: 'svc:api',
      kind: 'metric',
      labels: { env: 'prod' },
      attrs: { cpu_pct: 73 },
    });
  });

  it('config 2: kind from a field with a map, nested paths, epoch seconds, JSON string input', () => {
    const options = {
      entity: 'job:{{job.id}}',
      kind: { fromField: 'status', map: { start: 'session.start', done: 'turn.end', '*': 'heartbeat' } },
      labels: { name: '{{job.name}} #{{job.id}}' },
      ts: '{{when}}',
    };
    const a = mapAdapter.parse(JSON.stringify({ status: 'start', job: { id: 7, name: 'build' }, when: 1768467600 }), ctx(options))[0]!;
    expect(a).toMatchObject({ entity: 'job:7', kind: 'session.start', labels: { name: 'build #7' }, ts: '2026-01-15T09:00:00.000Z' });
    expect(mapAdapter.parse({ status: 'done', job: { id: 7 } }, ctx(options))[0]!.kind).toBe('turn.end');
    expect(mapAdapter.parse({ status: '???', job: { id: 7 } }, ctx(options))[0]!.kind).toBe('heartbeat');
    // no ts in record → now()
    expect(mapAdapter.parse({ status: 'done', job: { id: 7 } }, ctx(options))[0]!.ts).toBe('2026-01-15T10:00:00.000Z');
  });

  it('config 3: when filters records (globs) and a kind map without fallback drops unknowns', () => {
    const options = {
      entity: 'ci:{{repo}}',
      kind: { fromField: 'result', map: { ok: 'state' } },
      attrs: { status: 'idle', run: '{{n}}' },
      when: { repo: ['web-*', 'api'], 'branch': 'main' },
    };
    expect(mapAdapter.parse({ repo: 'web-app', branch: 'main', result: 'ok', n: 12 }, ctx(options))[0]!.attrs).toEqual({ status: 'idle', run: 12 });
    expect(mapAdapter.parse({ repo: 'api', branch: 'main', result: 'ok', n: 1 }, ctx(options))).toHaveLength(1);
    expect(mapAdapter.parse({ repo: 'docs', branch: 'main', result: 'ok' }, ctx(options))).toEqual([]);
    expect(mapAdapter.parse({ repo: 'api', branch: 'dev', result: 'ok' }, ctx(options))).toEqual([]);
    expect(mapAdapter.parse({ repo: 'api', branch: 'main', result: 'weird' }, ctx(options))).toEqual([]);
  });

  it('ignores non-JSON, empty entity and missing config', () => {
    expect(mapAdapter.parse('not json', ctx({ entity: 'x:{{a}}', kind: 'k' }))).toEqual([]);
    expect(mapAdapter.parse({ b: 1 }, ctx({ entity: '{{a}}', kind: 'k' }))).toEqual([]);
    expect(mapAdapter.parse({ a: 1 }, ctx({}))).toEqual([]);
  });
});
