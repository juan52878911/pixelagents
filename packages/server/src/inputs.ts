import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import type { Delta, Entity, InputConfig, StateSnapshot } from '@pixelagents/protocol';
import { LineSplitter, expandHome, parseMaybeJson, sleep } from './util.js';

type Cfg<T extends InputConfig['type']> = Extract<InputConfig, { type: T }>;

export interface InputHost {
  /** Raw record from this input → adapter → store. */
  push(raw: unknown): void;
  hubApply(upsert?: Entity[], remove?: string[], events?: Delta['events']): void;
  hubDrop(): void;
  warn(msg: string): void;
  signal: AbortSignal;
  fileTailMs: number;
}

/** Tail a file with rotation/truncation handling. Resolves when aborted. */
export async function runFile(cfg: Cfg<'file'>, host: InputHost): Promise<void> {
  const file = expandHome(cfg.path);
  const split = new LineSplitter();
  let fh: fs.promises.FileHandle | null = null;
  let ino = -1;
  let offset = 0;
  let first = true;

  const drain = async (): Promise<void> => {
    if (!fh) return;
    const buf = Buffer.allocUnsafe(256 * 1024);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      for (const line of split.push(buf.toString('utf8', 0, bytesRead))) host.push(parseMaybeJson(line));
    }
  };

  while (!host.signal.aborted) {
    try {
      const st = await fs.promises.stat(file).catch(() => null);
      if (st) {
        if (fh && st.ino !== ino) {
          await drain(); // rotated: finish the old file first
          await fh.close();
          fh = null;
        }
        if (!fh) {
          fh = await fs.promises.open(file, 'r');
          ino = st.ino;
          offset = first && !cfg.fromStart ? st.size : 0;
        } else if (st.size < offset) {
          offset = 0; // truncated
        }
        await drain();
      }
    } catch (err) {
      host.warn(`input ${cfg.id}: ${(err as Error).message}`);
    }
    first = false;
    await sleep(host.fileTailMs, host.signal);
  }
  await fh?.close().catch(() => {});
}

/** Spawn a command (no shell) and read stdout by lines; restart with backoff. */
export async function runCommand(cfg: Cfg<'command'>, host: InputHost): Promise<void> {
  const base = Math.max(0.01, cfg.restartSec ?? 5) * 1000;
  let delay = base;
  while (!host.signal.aborted) {
    const started = Date.now();
    await new Promise<void>((resolve) => {
      const split = new LineSplitter();
      let child;
      try {
        child = spawn(cfg.command, cfg.args ?? [], { stdio: ['ignore', 'pipe', 'ignore'], signal: host.signal });
      } catch (err) {
        host.warn(`input ${cfg.id}: ${(err as Error).message}`);
        return resolve();
      }
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (c: string) => {
        for (const line of split.push(c)) host.push(parseMaybeJson(line));
      });
      child.on('error', (err) => {
        if (!host.signal.aborted) host.warn(`input ${cfg.id}: ${err.message}`);
        resolve();
      });
      child.on('close', () => resolve());
    });
    if (host.signal.aborted) break;
    // backoff: quick failures double the wait (max 16x); a healthy run resets it
    delay = Date.now() - started > Math.max(30_000, base * 4) ? base : Math.min(delay * 2, base * 16);
    await sleep(delay, host.signal);
  }
}

function runOnce(cfg: Cfg<'poll'>, signal: AbortSignal): Promise<string> {
  if (cfg.command) {
    return new Promise((resolve, reject) => {
      execFile(cfg.command!, cfg.args ?? [], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, signal }, (err, stdout) =>
        err && !stdout ? reject(err) : resolve(String(stdout)),
      );
    });
  }
  if (cfg.url) {
    const headers: Record<string, string> = {};
    const tok = cfg.options?.token;
    if (typeof tok === 'string') headers.authorization = `Bearer ${tok}`;
    return fetch(cfg.url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
  }
  return Promise.reject(new Error('poll input needs command or url'));
}

/** The whole output of each run is ONE record. */
export async function runPoll(cfg: Cfg<'poll'>, host: InputHost): Promise<void> {
  while (!host.signal.aborted) {
    try {
      const out = await runOnce(cfg, host.signal);
      host.push(parseMaybeJson(out.trim()));
    } catch (err) {
      if (!host.signal.aborted) host.warn(`input ${cfg.id}: ${(err as Error).message}`);
    }
    await sleep(Math.max(0.05, cfg.everySec) * 1000, host.signal);
  }
}

/** Subscribe to another server's /events and mirror its entities. */
export async function runHub(cfg: Cfg<'hub'>, host: InputHost): Promise<void> {
  const url = cfg.url.replace(/\/+$/, '').replace(/\/events$/, '') + '/events';
  let delay = 500;
  while (!host.signal.aborted) {
    try {
      const headers: Record<string, string> = { accept: 'text/event-stream' };
      if (cfg.token) headers.authorization = `Bearer ${cfg.token}`;
      const res = await fetch(url, { headers, signal: host.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      delay = 500;
      const dec = new TextDecoder();
      let buf = '';
      let known = new Set<string>();
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(chunk, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = 'message';
          const data: string[] = [];
          for (const l of block.split('\n')) {
            if (l.startsWith('event:')) event = l.slice(6).trim();
            else if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, ''));
          }
          if (!data.length) continue;
          let payload: unknown;
          try {
            payload = JSON.parse(data.join('\n'));
          } catch {
            continue;
          }
          if (event === 'snapshot') {
            const s = payload as StateSnapshot;
            const ids = new Set(s.entities.map((e) => e.id));
            host.hubApply(s.entities, [...known].filter((id) => !ids.has(id)));
            known = ids;
          } else if (event === 'delta') {
            const d = payload as Delta;
            for (const e of d.upsert ?? []) known.add(e.id);
            for (const id of d.remove ?? []) known.delete(id);
            host.hubApply(d.upsert, d.remove, d.events);
          }
        }
      }
      throw new Error('stream closed');
    } catch (err) {
      host.hubDrop();
      if (host.signal.aborted) break;
      host.warn(`input ${cfg.id}: ${(err as Error).message}`);
    }
    await sleep(delay, host.signal);
    delay = Math.min(delay * 2, 15_000);
  }
}
