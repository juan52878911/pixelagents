import os from 'node:os';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function isLoopback(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || h === '::ffff:127.0.0.1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** JSON.parse when it parses, otherwise the raw string. */
export function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** HTTP ingest body: a JSON array, or NDJSON (one record per line). Non-JSON lines stay strings. */
export function parseBodyRecords(body: string): unknown[] {
  const t = body.trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v)) return v;
    } catch {
      /* fall through to NDJSON */
    }
  }
  const out: unknown[] = [];
  for (const line of t.split('\n')) {
    const l = line.trim();
    if (l) out.push(parseMaybeJson(l));
  }
  return out;
}

/** Splits a byte stream into lines, keeping the partial tail between pushes. */
export class LineSplitter {
  private tail = '';
  push(chunk: string): string[] {
    const parts = (this.tail + chunk).split('\n');
    this.tail = parts.pop() ?? '';
    return parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).filter((l) => l.length > 0);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(t);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
