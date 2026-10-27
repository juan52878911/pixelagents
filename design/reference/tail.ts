// Follows a file across appends, truncation, and rotation (rename-away +
// recreate at the same path). Path-based polling (not fd/inode based) so
// rotation "just works": once the old file is renamed away and a fresh
// empty file appears at the same path, the next stat sees a smaller size
// and we simply reset to offset 0 and keep reading.

import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface TailOptions {
  /** Byte offset to start reading from. Defaults to 0 (from the start). */
  fromOffset?: number;
  /** Poll interval in ms. Defaults to 300. Kept small in tests. */
  pollMs?: number;
  /** Abort the generator early (used to stop background tail loops). */
  signal?: AbortSignal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof (t as unknown as { unref?: () => void }).unref === "function") {
      (t as unknown as { unref: () => void }).unref();
    }
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

function statOrNull(path: string): { size: number } | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function readRange(path: string, start: number, end: number): string {
  const length = end - start;
  if (length <= 0) return "";
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    readSync(fd, buf, 0, length, start);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Read the whole file "now" (best-effort) and return its lines + size. */
export function readAllLines(path: string): { lines: string[]; size: number } {
  const stat = statOrNull(path);
  if (!stat) return { lines: [], size: 0 };
  const raw = readRange(path, 0, stat.size);
  const lines = raw.split("\n").filter((l) => l.length > 0);
  return { lines, size: stat.size };
}

/**
 * Async generator yielding new complete lines appended to `path` after
 * `fromOffset` (defaults to 0 = from the start of the file). Survives the
 * file not existing yet, truncation, and rename-based rotation. Runs until
 * `signal` is aborted.
 */
export async function* tail(path: string, opts: TailOptions = {}): AsyncGenerator<string> {
  const pollMs = opts.pollMs ?? 300;
  let offset = opts.fromOffset ?? 0;
  let carry = ""; // partial last line across polls

  while (!opts.signal?.aborted) {
    const stat = statOrNull(path);
    if (!stat) {
      // File doesn't exist (yet, or rotated away with nothing new yet).
      if (offset !== 0) {
        offset = 0;
        carry = "";
      }
      await sleep(pollMs, opts.signal);
      continue;
    }

    if (stat.size < offset) {
      // Truncated or rotated (new, smaller file at the same path).
      offset = 0;
      carry = "";
    }

    if (stat.size > offset) {
      const chunk = carry + readRange(path, offset, stat.size);
      offset = stat.size;
      const parts = chunk.split("\n");
      carry = parts.pop() ?? "";
      for (const line of parts) {
        if (line.length > 0) yield line;
      }
    }

    await sleep(pollMs, opts.signal);
  }
}
