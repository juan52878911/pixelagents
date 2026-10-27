import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { hostLocalInput, hostStatsAdapter, sampleLocal } from '../src/index.js';

const fx = (n: string) => readFileSync(new URL('../../../fixtures/' + n, import.meta.url), 'utf8');
const ctx = (host?: string) => ({ input: 'h', options: host ? { host } : {}, now: () => new Date('2026-01-15T10:00:00Z') });

describe('host-stats adapter', () => {
  it('linux: load = load1/ncpu in %', () => {
    const [e, ...rest] = hostStatsAdapter.parse(fx('host.linux.txt'), ctx('vm-1'));
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ entity: 'host:vm-1', kind: 'metric', labels: { host: 'vm-1' }, ts: '2026-01-15T10:00:00.000Z' });
    expect(e!.attrs).toEqual({ load1: 2.41, load5: 1.97, load15: 1.6, ncpu: 12, load: 20.08 });
  });

  it('macos', () => {
    const [e] = hostStatsAdapter.parse(fx('host.macos.txt'), ctx('mac'));
    expect(e!.entity).toBe('host:mac');
    expect(e!.attrs).toEqual({ load1: 3.12, load5: 2.8, load15: 2.55, ncpu: 10, load: 31.2 });
  });

  it('garbage yields nothing', () => {
    expect(hostStatsAdapter.parse('hola', ctx())).toEqual([]);
    expect(hostStatsAdapter.parse('1 2 3\n0', ctx())).toEqual([]);
    expect(hostStatsAdapter.parse(42, ctx())).toEqual([]);
  });

  it('samples from the host-local input', () => {
    const s = sampleLocal({ loadavg: () => [2, 1, 0.5], cpus: () => new Array(4).fill({}) as never, totalmem: () => 1000, freemem: () => 250 });
    expect(s).toEqual({ load1: 2, load5: 1, load15: 0.5, ncpu: 4, mem_pct: 75 });
    const [e] = hostStatsAdapter.parse(s, ctx('here'));
    expect(e!.attrs).toMatchObject({ load: 50, mem_pct: 75, ncpu: 4 });
  });
});

describe('host-local input', () => {
  it('pushes now and every everySec, stops on abort', () => {
    vi.useFakeTimers();
    try {
      const got: unknown[] = [];
      const ac = new AbortController();
      expect(hostLocalInput.type).toBe('host-local');
      hostLocalInput.start({ everySec: 2 }, (r) => got.push(r), ac.signal);
      expect(got).toHaveLength(1);
      vi.advanceTimersByTime(6000);
      expect(got).toHaveLength(4);
      ac.abort();
      vi.advanceTimersByTime(10000);
      expect(got).toHaveLength(4);
      expect(got[0]).toHaveProperty('ncpu');
    } finally {
      vi.useRealTimers();
    }
  });
});
