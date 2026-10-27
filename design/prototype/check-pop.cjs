// check-pop.cjs — verificación de pop.js (node check-pop.cjs)
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'pop.js'), 'utf8');
if (/\b(import|export|window|document|class)\b/.test(src.replace(/\/\/.*$/gm, ''))) {
  console.error('FALLO: pop.js usa import/export/window/document/class');
  process.exit(1);
}

// ---- stubs del motor ----
const OL = '#1a1423';
const FONT_LEN = 15;
const rects = []; // {x,y,w,h,c}
let nonInt = 0;
function rec(x, y, w, h, c) {
  if (![x, y, w, h].every(Number.isInteger)) nonInt++;
  rects.push({ x, y, w, h, c });
}
const g = { fillStyle: '#000', fillRect(x, y, w, h) { rec(x, y, w, h, this.fillStyle); }, globalAlpha: 1 };
function R(gg, x, y, w, h, c) { if (![x, y].every(Number.isInteger)) nonInt++; gg.fillStyle = c; gg.fillRect(x, y, w, h); }
function spr(gg, rows, x, y, pal, flip) {
  if (![x, y].every(Number.isInteger)) nonInt++;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r], w = row.length;
    for (let c = 0; c < w; c++) { const col = pal[row[c]]; if (!col) continue; gg.fillStyle = col; gg.fillRect(x + (flip ? w - 1 - c : c), y + r, 1, 1); }
  }
}
const TXT_OK = /^[A-Z0-9$%.:\-@\/!?·+_ ]*$/;
function txt(gg, s, x, y, c, sc) {
  sc = sc || 1; s = String(s).toUpperCase();
  if (![x, y].every(Number.isInteger)) nonInt++;
  if (!TXT_OK.test(s)) throw new Error('txt con carácter fuera de la fuente: ' + s);
  gg.fillStyle = c;
  for (let i = 0; i < s.length; i++) for (let k = 0; k < FONT_LEN; k++) gg.fillRect(x + (i * 4 + k % 3) * sc, y + Math.floor(k / 3) * sc, sc, sc);
}
function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return n >>> 0; }

const lib = new Function('R', 'spr', 'txt', 'hash', 'OL', src + '\nreturn { POP_DECO, POP_EMOJI, POP_GAGS };')(R, spr, txt, hash, OL);

let errors = 0;
const err = (m) => { errors++; console.error('  FALLO: ' + m); };
const COLOR = /^(#[0-9a-fA-F]{6}|rgba\([^)]*\))$/;

function checkSprite(id, d, w, h) {
  if (!d.name) err(`${id}: sin name`);
  if (typeof d.fps !== 'number' || d.fps < 0) err(`${id}: fps inválido`);
  if (!Array.isArray(d.frames) || d.frames.length < 1) return err(`${id}: sin frames`);
  if (d.fps > 0 && d.frames.length < 2) err(`${id}: fps>0 pero un solo frame`);
  for (const [k, c] of Object.entries(d.pal)) if (!COLOR.test(c)) err(`${id}: color inválido pal[${k}]=${c}`);
  d.frames.forEach((f, fi) => {
    if (f.length !== h) err(`${id} frame ${fi}: ${f.length} filas, esperaba ${h}`);
    f.forEach((row, ri) => {
      if (row.length !== w) err(`${id} frame ${fi} fila ${ri}: ancho ${row.length}, esperaba ${w}`);
      for (const ch of row) if (ch !== '.' && !(ch in d.pal)) err(`${id} frame ${fi} fila ${ri}: '${ch}' no está en pal`);
    });
  });
}

// ---- decoración ----
let nWall = 0, nFloor = 0, nAnim = 0;
for (const [id, d] of Object.entries(lib.POP_DECO)) {
  if (d.place === 'wall') { nWall++; if (d.h > 12 || d.w > 16) err(`${id}: pared excede 16×12 (${d.w}×${d.h})`); }
  else if (d.place === 'floor') { nFloor++; if (d.w > 18 || d.h > 20) err(`${id}: suelo excede 18×20 (${d.w}×${d.h})`); }
  else err(`${id}: place inválido`);
  if (d.fps > 0) nAnim++;
  checkSprite('deco.' + id, d, d.w, d.h);
}
console.log(`deco: ${Object.keys(lib.POP_DECO).length} (pared ${nWall}, suelo ${nFloor}, animadas ${nAnim})`);
if (Object.keys(lib.POP_DECO).length < 14 || nWall < 5 || nFloor < 7) err('mínimos de decoración no alcanzados');

// ---- emojis ----
const needEmoji = ['corazon', 'estrella', 'fuego', 'pulgar', 'cafe', 'bicho', 'fiesta', 'cohete', 'bombilla', 'calavera', 'cien', 'ojos'];
for (const [id, e] of Object.entries(lib.POP_EMOJI)) {
  checkSprite('emoji.' + id, e, 9, 9);
  if (!e.frames.some(f => f.some(r => r.includes(Object.keys(e.pal).find(k => e.pal[k] === OL) || '\u0000')))) err(`emoji ${id}: sin contorno OL`);
}
for (const id of needEmoji) if (!lib.POP_EMOJI[id]) err(`falta emoji ${id}`);
console.log(`emoji: ${Object.keys(lib.POP_EMOJI).length}`);
if (Object.keys(lib.POP_EMOJI).length < 12) err('mínimo de 12 emojis no alcanzado');

// ---- gags ----
const PS = [0, 0.25, 0.5, 0.75, 1, 0.1, 0.33, 0.42, 0.61, 0.83, 0.95];
const TS = [0, 0.37, 1.23, 7.77, 100.5];
const ORIGINS = [[100, 100], [37, 53], [0, 26]];
for (const [id, gag] of Object.entries(lib.POP_GAGS)) {
  if (!gag.name || typeof gag.dur !== 'number' || gag.dur <= 0) err(`gag ${id}: name/dur inválidos`);
  if (typeof gag.draw !== 'function') { err(`gag ${id}: sin draw`); continue; }
  let drew = 0;
  for (const [x, y] of ORIGINS) for (const p of PS) for (const t of TS) {
    rects.length = 0; nonInt = 0;
    try {
      if (gag.pose) {
        const po = gag.pose(p);
        if (typeof po !== 'object' || po === null) err(`gag ${id}: pose(${p}) no devuelve objeto`);
        else {
          if ('lift' in po && !Number.isInteger(po.lift)) err(`gag ${id}: pose(${p}).lift no entero: ${po.lift}`);
          if ('arms' in po && po.arms !== 'up') err(`gag ${id}: pose(${p}).arms raro: ${po.arms}`);
        }
      }
      gag.draw(g, x, y, p, t);
    } catch (e) { err(`gag ${id} p=${p} t=${t}: lanza ${e.message}`); continue; }
    if (nonInt) err(`gag ${id} p=${p} t=${t}: ${nonInt} llamadas con coordenadas no enteras`);
    for (const r of rects) {
      if (r.w <= 0 || r.h <= 0) err(`gag ${id} p=${p}: rect de tamaño no positivo`);
      if (!COLOR.test(r.c)) err(`gag ${id} p=${p}: color inválido ${r.c}`);
      if (r.x < x - 10 || r.x + r.w > x + 20 || r.y < y - 26 || r.y + r.h > y + 12) {
        err(`gag ${id} p=${p} t=${t}: fuera de caja (${r.x - x},${r.y - y},${r.w}x${r.h})`); break;
      }
    }
    drew += rects.length;
  }
  if (drew === 0) err(`gag ${id}: no dibuja nada`);
}
console.log(`gags: ${Object.keys(lib.POP_GAGS).length}`);
if (Object.keys(lib.POP_GAGS).length < 7) err('mínimo de 7 gags no alcanzado');

if (errors) { console.error(`\n${errors} fallo(s)`); process.exit(1); }
console.log('\nOK: pop.js pasa todas las comprobaciones');
