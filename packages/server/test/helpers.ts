import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, mergeConfig, type PaConfig, type PaEvent } from '@pixelagents/protocol';
import { createServer, type PixelServer, type ServerOptions } from '../src/index.js';

export const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'pa-server-'));

export function mkConfig(port: number, over: Record<string, unknown> = {}): PaConfig {
  const base = mergeConfig(DEFAULT_CONFIG, {
    server: { host: '127.0.0.1', port },
    plugins: [],
    inputs: [{ id: 'http', type: 'http', adapter: 'pa' }],
    classify: [],
  });
  base.groups = { by: '{{labels.host}}', label: 'Office {{labels.host}}', kinds: { 'lab-*': 'lab', '*': 'office' } };
  return mergeConfig(base, over);
}

export interface Ctx {
  server: PixelServer;
  url: string;
  dir: string;
  clock: { t: number; advance(sec: number): void };
}

const open: PixelServer[] = [];
export async function start(port: number, over: Record<string, unknown> = {}, opts: ServerOptions = {}): Promise<Ctx> {
  const dir = opts.dataDir ?? tmp();
  const clock = {
    t: Date.parse('2026-01-01T00:00:00Z'),
    advance(sec: number) {
      this.t += sec * 1000;
    },
  };
  const server = createServer(mkConfig(port, over), {
    dataDir: dir,
    now: () => new Date(clock.t),
    tickMs: 0,
    snapshotMs: 0,
    flushMs: 20,
    fileTailMs: 25,
    log: () => {},
    ...opts,
  });
  open.push(server);
  await server.listen();
  return { server, url: `http://127.0.0.1:${server.port}`, dir, clock };
}

export async function stopAll(): Promise<void> {
  await Promise.all(open.splice(0).map((s) => s.close()));
}

export function ev(clock: { t: number }, entity: string, kind: string, attrs?: Record<string, unknown>, extra: Partial<PaEvent> = {}): PaEvent {
  return { ts: new Date(clock.t).toISOString(), source: 'test', entity, kind, attrs, ...extra };
}

export async function waitFor<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 15));
  }
}

export const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });

export async function sse(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const res = await fetch(url, { headers, signal: ctrl.signal });
  const frames: { event: string; data: any }[] = [];
  void (async () => {
    const dec = new TextDecoder();
    let buf = '';
    try {
      for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += dec.decode(c, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const e = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (e && data) frames.push({ event: e, data: JSON.parse(data) });
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { frames, close: () => ctrl.abort() };
}
