// Usage: node packages/web/scripts/world-ascii.mjs <seed> [offices=5] [agentsPerOffice=4]
// Prints the generated town as ASCII: letters = offices (A..L), '#' hall wall row, '.' grass,
// ':' path, 'P' plaza, 'T' tree, 'b' bush, '^' door.
import { tsImport } from 'tsx/esm/api';

const { generateWorld } = await tsImport('../src/world/index.ts', import.meta.url);
const seed = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const nOff = Math.min(12, Math.max(1, Number(process.argv[3] ?? 5)));
const nAg = Math.max(0, Number(process.argv[4] ?? 4));
const kinds = ['office', 'office', 'server', 'lab', 'office'];
const groups = Array.from({ length: nOff }, (_, i) => {
  const kind = kinds[i % kinds.length];
  const id = `g${i}`;
  return kind === 'lab'
    ? { id, kind, label: `LAB-${i}`, zones: [], pods: Array.from({ length: nAg }, (_, k) => `${id}-pod${k}`) }
    : { id, kind, label: `OFFICE-${i}`, zones: [
        { id: `${id}-z0`, label: 'ALPHA', agents: Array.from({ length: nAg }, (_, k) => `${id}-a${k}`) },
        { id: `${id}-z1`, label: 'BETA', agents: [`${id}-b0`] },
      ] };
});
const w = generateWorld({ seed, groups, decor: [] });
const corridor = new Set(w.corridor);
const grid = [];
for (let r = 0; r < w.rows; r++) {
  const line = [];
  for (let c = 0; c < w.cols; c++) {
    const o = w.own[r][c];
    const k = r * w.cols + c;
    line.push(o >= 0 ? String.fromCharCode(65 + o) : o === -2 ? (corridor.has(k) ? '=' : '-') : '.');
  }
  grid.push(line);
}
const set = (c, r, ch) => { if (grid[r] && grid[r][c] !== undefined) grid[r][c] = ch; };
for (const k of w.path) set(k % w.cols, Math.floor(k / w.cols), ':');
if (w.plazaOk) for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) set(w.plaza[0] + dc, w.plaza[1] + dr, 'P');
for (const t of w.trees) set(t.c, t.r, 'T');
for (const b of w.bushes) set(b.c, b.r, 'b');
for (const o of w.offices) set(o.doorTile[0], o.doorTile[1], '^');
console.log(`seed=${seed} season=${w.season} map=${w.cols}x${w.rows} tiles, buildEnd=${w.build.buildEnd.toFixed(1)}s`);
console.log(grid.map((l) => l.join('')).join('\n'));
for (const [i, o] of w.offices.entries()) {
  const slots = o.zones.reduce((n, z) => n + z.slots.length, 0) + o.capsules.length;
  console.log(`${String.fromCharCode(65 + i)} ${o.label.padEnd(10)} ${o.kind.padEnd(7)} ${o.strategy.padEnd(8)} hall ${o.tw}x${o.th} @${o.tx},${o.ty} slots=${slots}`);
}
