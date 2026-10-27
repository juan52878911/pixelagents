// `pixelagents agent`: follows events.jsonl (and extra files) with rotation handling (ported from
// design/reference/tail.ts, but offset-based and persistent), batches complete lines and POSTs them
// to a hub as NDJSON. Offsets advance only after a 2xx, so a network cut loses nothing and (within a
// run) duplicates nothing. Every 15 s it also reports the host load as a `metric` PaEvent.
import { closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { cpus, freemem, homedir, hostname, loadavg, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import type { PaEvent } from '@pixelagents/protocol';

export interface AgentOptions {
  hub: string;
  token: string;
  /** Extra files to follow besides $PIXELAGENTS_DIR/events.jsonl. */
  files?: string[];
  /** Replaces $PIXELAGENTS_DIR (default ~/.pixelagents). */
  dir?: string;
  fetch?: typeof fetch;
  pollMs?: number;
  /** Host metric period; 0 disables. Default 15000. */
  metricsMs?: number;
  maxBatchLines?: number;
  maxBatchBytes?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  host?: string;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface AgentStats {
  sentLines: number;
  sentBatches: number;
  failures: number;
  droppedLines: number;
}

export interface AgentHandle {
  stats: AgentStats;
  /** Resolves when everything currently readable has been delivered (rejects on timeout). */
  drain(timeoutMs?: number): Promise<void>;
  stop(): Promise<void>;
}

interface FileState {
  offset: number;
  ino?: number;
}
interface StateFile {
  v: 1;
  files: Record<string, FileState>;
}

const MAX_LINE_BYTES = 1 << 20;

export function pixelagentsDir(env = process.env): string {
  return env.PIXELAGENTS_DIR || join(homedir(), '.pixelagents');
}

function loadState(path: string): StateFile {
  try {
    const s = JSON.parse(readFileSync(path, 'utf8')) as StateFile;
    if (s && s.v === 1 && s.files && typeof s.files === 'object') return s;
  } catch {
    /* fresh */
  }
  return { v: 1, files: {} };
}

function saveState(path: string, s: StateFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, path);
}

interface Chunk {
  lines: string[];
  /** Bytes consumed (complete lines, or dropped oversized garbage). */
  consumed: number;
  dropped: number;
}

/** Read up to the limits of COMPLETE lines starting at offset. */
function readLines(path: string, offset: number, size: number, maxLines: number, maxBytes: number): Chunk {
  const want = Math.min(size - offset, Math.max(maxBytes, 1));
  const fd = openSync(path, 'r');
  let buf: Buffer;
  try {
    buf = Buffer.alloc(want);
    const n = readSync(fd, buf, 0, want, offset);
    buf = buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
  let end = buf.lastIndexOf(0x0a);
  if (end < 0) {
    // No newline yet: wait for the writer, unless the line is absurdly long (drop it).
    if (buf.length >= MAX_LINE_BYTES) return { lines: [], consumed: buf.length, dropped: 1 };
    return { lines: [], consumed: 0, dropped: 0 };
  }
  end += 1;
  const text = buf.subarray(0, end).toString('utf8');
  let lines = text.split('\n');
  lines.pop();
  let consumed = end;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    consumed = Buffer.byteLength(lines.join('\n') + '\n', 'utf8');
  }
  return { lines: lines.filter((l) => l.trim().length > 0), consumed, dropped: 0 };
}

export function startAgent(opts: AgentOptions): AgentHandle {
  const f = opts.fetch ?? fetch;
  const dir = opts.dir ?? pixelagentsDir();
  const files = [join(dir, 'events.jsonl'), ...(opts.files ?? [])];
  const statePath = join(dir, 'agent-state.json');
  const state = loadState(statePath);
  const pollMs = opts.pollMs ?? 300;
  const maxLines = opts.maxBatchLines ?? 500;
  const maxBytes = opts.maxBatchBytes ?? 256 * 1024;
  const base = opts.backoffMs ?? 1000;
  const maxBackoff = opts.maxBackoffMs ?? 30000;
  const hub = opts.hub.replace(/\/+$/, '');
  const log = opts.log ?? (() => {});
  const host = opts.host ?? process.env.PIXELAGENTS_HOST ?? (hostname().split('.')[0] || 'unknown');
  const now = opts.now ?? (() => new Date());
  const stats: AgentStats = { sentLines: 0, sentBatches: 0, failures: 0, droppedLines: 0 };

  let stopped = false;
  let wake: (() => void) | null = null;
  const sleep = (ms: number) =>
    new Promise<void>((res) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        wake = null;
        res();
      }
      wake = done;
    });

  const post = async (adapter: string, body: string): Promise<'ok' | 'retry' | 'drop'> => {
    try {
      const r = await f(`${hub}/v1/events?adapter=${adapter}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/x-ndjson' },
        body,
        signal: AbortSignal.timeout(10000),
      });
      if (r.status >= 200 && r.status < 300) return 'ok';
      if ([400, 413, 415, 422].includes(r.status)) return 'drop';
      log(`hub answered ${r.status}`);
      return 'retry';
    } catch (e) {
      log(`hub unreachable: ${(e as Error).message}`);
      return 'retry';
    }
  };

  /** One pass over all files. Returns { sent, failed }. */
  const pump = async (): Promise<{ sent: number; failed: boolean }> => {
    let sent = 0;
    for (const path of files) {
      for (;;) {
        if (stopped) return { sent, failed: false };
        let st;
        try {
          st = statSync(path);
        } catch {
          if (state.files[path]) delete state.files[path];
          break;
        }
        let fs = state.files[path];
        if (!fs) {
          fs = state.files[path] = { offset: 0, ino: st.ino };
        } else if (st.size < fs.offset || (fs.ino !== undefined && st.ino !== fs.ino)) {
          fs.offset = 0; // truncated or rotated
          fs.ino = st.ino;
        }
        if (st.size <= fs.offset) break;
        const chunk = readLines(path, fs.offset, st.size, maxLines, maxBytes);
        if (chunk.consumed === 0) break;
        if (chunk.lines.length > 0) {
          const res = await post('claude-code', chunk.lines.join('\n') + '\n');
          if (res === 'retry') {
            stats.failures++;
            return { sent, failed: true };
          }
          if (res === 'drop') {
            stats.droppedLines += chunk.lines.length;
            log(`dropped ${chunk.lines.length} lines rejected by the hub`);
          } else {
            stats.sentLines += chunk.lines.length;
            stats.sentBatches++;
            sent += chunk.lines.length;
          }
        }
        stats.droppedLines += chunk.dropped;
        fs.offset += chunk.consumed;
        saveState(statePath, state);
      }
    }
    return { sent, failed: false };
  };

  const sendMetrics = async () => {
    const total = totalmem();
    const ev: PaEvent = {
      ts: now().toISOString(),
      source: 'pixelagents-agent',
      entity: `host:${host}`,
      kind: 'metric',
      attrs: {
        load: Math.round((loadavg()[0] ?? 0) * 100) / 100,
        cpus: cpus().length,
        mem_used_pct: total > 0 ? Math.round((1 - freemem() / total) * 1000) / 10 : 0,
      },
    };
    await post('pa', JSON.stringify(ev) + '\n');
  };

  let idle = false;
  const loop = (async () => {
    let backoff = base;
    while (!stopped) {
      let r: { sent: number; failed: boolean };
      try {
        r = await pump();
      } catch (e) {
        log(`agent error: ${(e as Error).message}`);
        r = { sent: 0, failed: true };
      }
      idle = !r.failed && r.sent === 0;
      if (r.failed) {
        await sleep(backoff);
        backoff = Math.min(backoff * 2, maxBackoff);
      } else {
        backoff = base;
        if (r.sent === 0) await sleep(pollMs);
      }
    }
  })();

  const metricsMs = opts.metricsMs ?? 15000;
  let metricsTimer: NodeJS.Timeout | undefined;
  if (metricsMs > 0) {
    void sendMetrics();
    metricsTimer = setInterval(() => void sendMetrics(), metricsMs);
    metricsTimer.unref();
  }

  return {
    stats,
    async drain(timeoutMs = 10000) {
      const t0 = Date.now();
      for (;;) {
        // Idle and nothing readable left.
        const pending = files.some((p) => {
          try {
            return statSync(p).size > (state.files[p]?.offset ?? 0);
          } catch {
            return false;
          }
        });
        if (idle && !pending) return;
        if (Date.now() - t0 > timeoutMs) throw new Error('drain timeout');
        if (idle) wake?.();
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    async stop() {
      stopped = true;
      if (metricsTimer) clearInterval(metricsTimer);
      wake?.();
      await loop;
    },
  };
}
