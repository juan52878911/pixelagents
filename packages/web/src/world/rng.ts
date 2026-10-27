/** Deterministic helpers: FNV-1a string hash and mulberry32 rng. */
export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Rng {
  f(): number;
  i(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  let a = seed | 0;
  const f = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    f,
    i: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(f() * arr.length)] as T,
  };
}

export function shuffle<T>(arr: T[], rg: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rg.f() * (i + 1));
    const x = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = x;
  }
  return arr;
}
