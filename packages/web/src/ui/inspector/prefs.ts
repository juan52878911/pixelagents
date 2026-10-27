/** Toggles remembered in localStorage; every access is guarded (private windows, blocked storage). */
export function readPref(key: string, fallback: boolean): boolean {
  try { const v = localStorage.getItem(`pa.${key}`); return v === null ? fallback : v === '1'; } catch { return fallback; }
}
export function writePref(key: string, v: boolean): void {
  try { localStorage.setItem(`pa.${key}`, v ? '1' : '0'); } catch { /* ignore */ }
}
