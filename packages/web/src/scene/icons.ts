/** 7×7 pixel icons for activity categories, shown over working actors (O = outline). */
import type { Painter } from '../engine/painter.js';

const OL = '#1a1423';
interface Icon { rows: string[]; pal: Record<string, string> }

export const ICONS: Record<string, Icon> = {
  // open book
  read: { rows: ['OOO.OOO', 'OwwOwwO', 'OwlOwlO', 'OwwOwwO', 'OwlOwlO', 'OwwOwwO', '.OOOOO.'], pal: { O: OL, w: '#e9f2f7', l: '#79c0ff' } },
  // pencil
  edit: { rows: ['....OO.', '...OpgO', '..OyyO.', '.OyyO..', 'OyyO...', 'OwO....', 'OO.....'], pal: { O: OL, y: '#f2c14e', p: '#e57a9a', g: '#8f96a3', w: '#f5e6c8' } },
  // terminal prompt
  run: { rows: ['OOOOOOO', 'OkkkkkO', 'OgkkkkO', 'OkgkkkO', 'OgkggkO', 'OkkkkkO', 'OOOOOOO'], pal: { O: OL, k: '#0f1b26', g: '#7ee787' } },
  // globe
  web: { rows: ['.OOOOO.', 'ObgbgbO', 'OgbbbgO', 'ObbgbbO', 'OgbbbgO', 'ObgbgbO', '.OOOOO.'], pal: { O: OL, b: '#4a90e2', g: '#4cc38a' } },
  // light bulb
  think: { rows: ['.OOOOO.', 'OyyyywO', 'OyyyyyO', '.OyyyO.', '..OgO..', '..OgO..', '..OOO..'], pal: { O: OL, y: '#ffd23f', w: '#ffffff', g: '#8f96a3' } },
  // speech
  talk: { rows: ['OOOOOOO', 'OwwwwwO', 'OwOwOwO', 'OwwwwwO', 'OOOwOOO', '..OwO..', '..OO...'], pal: { O: OL, w: '#ffffff' } },
  // hourglass
  wait: { rows: ['OOOOOOO', '.OyyyO.', '..OyO..', '...O...', '..OwO..', '.OyyyO.', 'OOOOOOO'], pal: { O: OL, y: '#ffd23f', w: '#e9f2f7' } },
};

export function drawIcon(g: Painter, cat: string | undefined, x: number, y: number): boolean {
  const ic = cat ? ICONS[cat] : undefined;
  if (!ic) return false;
  g.sprite(ic.rows, x, y, ic.pal);
  return true;
}
