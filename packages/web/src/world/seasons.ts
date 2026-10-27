export interface SeasonPalette {
  g: string; d: string; l: string; fl: string[]; c: string; cd: string; ch: string;
}
export const SEASONS: Record<string, SeasonPalette> = {
  verano: { g: '#3f7a3a', d: '#356b31', l: '#4a8a43', fl: ['#f2c14e', '#ffffff', '#e57a9a', '#9b5de5'], c: '#3f8a3a', cd: '#2e6a2c', ch: '#5aa84a' },
  otono: { g: '#6b7a34', d: '#5a6a2c', l: '#7a8a3c', fl: ['#e8833a', '#c4302b', '#f2c14e'], c: '#d9822b', cd: '#a85a1c', ch: '#f2b04e' },
  invierno: { g: '#d6e2ea', d: '#c4d2dc', l: '#f2f7fa', fl: ['#9fdcff', '#ffffff'], c: '#2f6a4a', cd: '#24523a', ch: '#ffffff' },
};

/** Season from a seed like "2026-01-15" (same month mapping as the prototype). */
export function seasonFromSeed(seed: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(seed);
  if (!m) return 'verano';
  const mo = Number(m[2]) - 1;
  return mo >= 8 && mo <= 10 ? 'otono' : mo === 11 || mo <= 1 ? 'invierno' : 'verano';
}
