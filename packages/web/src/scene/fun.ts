/**
 * Gag/emoji scheduler (port of gagNow/emojiNow): every `fun.everySec` one awake agent plays a gag,
 * and half a period later another throws an emoji. Pure and deterministic in t.
 */
import type { FunConfig } from '@pixelagents/protocol';

export function hash(n: number): number {
  n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15);
  return n >>> 0;
}

export interface Scheduled { agent: string; id: string; p: number }

/** Gag names allowed by `fun.gags` (true = all, false = none, list = those that exist). */
export function allowedGags(fun: Pick<FunConfig, 'gags'> | undefined, all: string[]): string[] {
  const g = fun?.gags ?? true;
  if (g === false) return [];
  if (g === true) return all;
  return g.filter((x) => all.includes(x));
}

/** The gag playing at time t (seconds), or null. `durOf` gives each gag's duration. */
export function gagAt(t: number, fun: FunConfig | undefined, gags: string[], durOf: (id: string) => number, cand: string[]): Scheduled | null {
  const ids = allowedGags(fun, gags);
  if (!ids.length || !cand.length) return null;
  const F = Math.max(2, fun?.everySec ?? 8), k = Math.floor(t / F), lt = t - k * F;
  const id = ids[hash(k * 7 + 3) % ids.length]!;
  const dur = durOf(id);
  if (lt > dur) return null;
  return { agent: cand[hash(k * 13 + 1) % cand.length]!, id, p: lt / dur };
}

export const EMOJI_DUR = 1.6;

export function emojiAt(t: number, fun: FunConfig | undefined, emojis: string[], cand: string[]): Scheduled | null {
  if (fun?.emojis === false || !emojis.length || !cand.length) return null;
  const F = Math.max(2, (fun?.everySec ?? 8) * 0.6), tt = t + F * 0.5, k = Math.floor(tt / F), lt = tt - k * F;
  if (lt > EMOJI_DUR) return null;
  return { agent: cand[hash(k * 29 + 5) % cand.length]!, id: emojis[hash(k * 3 + 11) % emojis.length]!, p: lt / EMOJI_DUR };
}
