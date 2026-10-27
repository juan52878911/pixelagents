import os from 'node:os';
import { definePlugin, type Adapter, type InputFactory, type PaEvent } from '@pixelagents/protocol';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Parses `cat /proc/loadavg; nproc` and `sysctl -n vm.loadavg hw.ncpu` outputs. */
export function parseLoad(text: string): { load1: number; load5: number; load15: number; ncpu: number } | null {
  const lines = text.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const nums = lines[0]!.replace(/[{}]/g, ' ').trim().split(/\s+/).slice(0, 3).map(Number);
  const ncpu = Number(lines[1]);
  if (nums.length < 3 || nums.some((n) => !Number.isFinite(n)) || !Number.isFinite(ncpu) || ncpu <= 0) return null;
  return { load1: nums[0]!, load5: nums[1]!, load15: nums[2]!, ncpu };
}

export const hostStatsAdapter: Adapter = {
  name: 'host-stats',
  parse(raw, ctx) {
    const host = typeof ctx.options.host === 'string' && ctx.options.host ? ctx.options.host : 'local';
    const attrs: Record<string, number> = {};
    if (typeof raw === 'string') {
      const p = parseLoad(raw);
      if (!p) return [];
      Object.assign(attrs, p, { load: r2((p.load1 / p.ncpu) * 100) });
    } else if (raw && typeof raw === 'object') {
      // sample pushed by the host-local input
      const s = raw as Record<string, unknown>;
      const load1 = Number(s.load1);
      const ncpu = Number(s.ncpu);
      if (!Number.isFinite(load1) || !Number.isFinite(ncpu) || ncpu <= 0) return [];
      Object.assign(attrs, { load1, ncpu, load: r2((load1 / ncpu) * 100) });
      for (const k of ['load5', 'load15', 'mem_pct']) if (s[k] != null && Number.isFinite(Number(s[k]))) attrs[k] = Number(s[k]);
    } else return [];
    const ev: PaEvent = {
      ts: ctx.now().toISOString(),
      source: ctx.input,
      entity: `host:${host}`,
      kind: 'metric',
      labels: { host },
      attrs,
    };
    return [ev];
  },
};

/** One sample of the local machine. Injectable for tests. */
export function sampleLocal(src: Pick<typeof os, 'loadavg' | 'cpus' | 'totalmem' | 'freemem'> = os): Record<string, number> {
  const [load1 = 0, load5 = 0, load15 = 0] = src.loadavg();
  const total = src.totalmem();
  return {
    load1,
    load5,
    load15,
    ncpu: Math.max(1, src.cpus().length),
    mem_pct: total > 0 ? r2(((total - src.freemem()) / total) * 100) : 0,
  };
}

/** `type: "host-local"`: pushes a local sample every `everySec` (default 5) to the configured adapter (host-stats). */
export const hostLocalInput: InputFactory = {
  type: 'host-local',
  start(cfg, push, signal) {
    const every = Math.max(1, Number(cfg.everySec) || 5);
    const tick = () => push(sampleLocal());
    tick();
    const timer = setInterval(tick, every * 1000);
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  },
};

export default definePlugin({ name: 'host-stats', adapters: [hostStatsAdapter], inputs: [hostLocalInput] });
