import fs from 'node:fs';
import vm from 'node:vm';
const REPO = process.argv[2];
const P = REPO + '/design/prototype/';
const html = fs.readFileSync(P + 'prototype.html', 'utf8').split('\n');
const L = (a, b) => html.slice(a - 1, b).join('\n');
const code = [L(8, 1564), L(1587, 1591), L(1932, 1984)].join('\n') +
  '\n;globalThis.X={FONT,OL,SKIN,HAIR,ACC,HEAD_F,HEAD_S,HEAD_B,BODY_F,BODY_SEAT,BODY_UP,BODY_S,LEGS_F,LEGS_S,HAIRX,ACCX,MINI,GHOST,PIG,PIGPAL,SEASONS,TREE,' +
  'bubble,drawDesk,drawChair,drawDoor,drawTomb,drawPlant,drawSofa,drawCooler,drawRack,drawDeco,drawTree,coin,hash,R,spr,txt};';
const ctx = { Math, console };
vm.createContext(ctx); vm.runInContext(code, ctx);
const X = ctx.X;
const pop = vm.runInNewContext(fs.readFileSync(P + 'pop.js', 'utf8') + '\n({POP_DECO,POP_EMOJI})', { R: X.R, spr: X.spr, txt: X.txt, hash: X.hash, OL: X.OL });

// ---------- recorder: ejecuta el código de dibujo del prototipo sobre un lienzo y lo vuelve filas ----------
const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function parse(c) {
  if (c[0] === '#') return { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16), a: 1 };
  const m = c.match(/rgba\(([^)]*)\)/)[1].split(',').map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] };
}
const hex2 = (n) => Math.round(n).toString(16).padStart(2, '0');
function Rec(w, h, ox, oy) {
  const grid = Array.from({ length: h }, () => Array(w).fill(null));
  const g = {
    fillStyle: '#000', globalAlpha: 1,
    fillRect(x, y, ww, hh) {
      const c = parse(this.fillStyle); const a = c.a * this.globalAlpha;
      for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) {
        const gx = x + i + ox, gy = y + j + oy;
        if (gx < 0 || gy < 0 || gx >= w || gy >= h) throw new Error(`fuera de lienzo ${gx},${gy} (${w}x${h})`);
        const old = grid[gy][gx];
        if (a >= 1) { grid[gy][gx] = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`; continue; }
        if (old && old[0] === '#') {
          const o = parse(old);
          grid[gy][gx] = `#${hex2(o.r * (1 - a) + c.r * a)}${hex2(o.g * (1 - a) + c.g * a)}${hex2(o.b * (1 - a) + c.b * a)}`;
        } else grid[gy][gx] = `rgba(${c.r},${c.g},${c.b},${+a.toFixed(3)})`;
      }
    },
  };
  g.grid = grid; g.w = w; g.h = h; g.ox = ox; g.oy = oy;
  return g;
}
function toSprite(name, recs, extra = {}) {
  const pal = {}, rev = {}; let n = 0;
  const frames = recs.map((r) => r.grid.map((row) => row.map((c) => {
    if (!c) return '.';
    if (!(c in rev)) { const k = POOL[n++]; rev[c] = k; pal[k] = c; }
    return rev[c];
  }).join('')));
  return { name, w: recs[0].w, h: recs[0].h, palette: pal, frames, anchor: [recs[0].ox, recs[0].oy], ...extra };
}
function trim(rec) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  rec.grid.forEach((row, y) => row.forEach((c, x) => { if (c) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }));
  const o = Rec(x1 - x0 + 1, y1 - y0 + 1, rec.ox - x0, rec.oy - y0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) o.grid[y - y0][x - x0] = rec.grid[y][x];
  return o;
}
const one = (w, h, ox, oy, fn) => { const r = Rec(w, h, ox, oy); fn(r); return trim(r); };
const fixed = (w, h, ox, oy, fn) => { const r = Rec(w, h, ox, oy); fn(r); return r; };
const R = X.R;
const OL = X.OL;
const compact = (o) => JSON.stringify(o, null, 1)
  .replace(/\[\n\s+("(?:[^"\\]|\\.)*"(?:,\n\s+"(?:[^"\\]|\\.)*")*)\n\s+\]/g, (m, inner) => '[' + inner.replace(/,\n\s+/g, ', ') + ']')
  .replace(/\[\n\s+(-?\d+),\n\s+(-?\d+)\n\s+\]/g, '[$1, $2]');
const out = (file, obj) => { fs.mkdirSync(REPO + '/assets', { recursive: true }); fs.writeFileSync(REPO + '/assets/' + file, compact(obj) + '\n'); };

// ================= characters =================
const CHAR_PAL = { H: X.HAIR[0], S: X.SKIN[0][0], s: X.SKIN[0][1], E: OL, m: '#7a2a2a', B: '#3b7dd8', b: '#2756a3', P: '#34304a', K: '#15121c',
  A: '#dfe7f7', a: '#6fa3ff', C: '#3fc79a', c: '#25916c', T: '#7a1e2c', W: '#f4efe6' };
const palOf = (frames) => { const s = new Set(frames.flat().join('')); s.delete('.'); const p = {}; for (const k of s) p[k] = CHAR_PAL[k]; return p; };
const csprites = [];
const pad = (rows) => rows.map((r) => r.padEnd(10, '.'));
function cs(name, rows, part, fps) {
  const frames = rows.map(pad);
  const dy = { head: 0, body: 6, legs: 10 }[part];
  csprites.push({ name, w: 10, h: frames[0].length, palette: palOf(frames), frames, anchor: [5, 14 - dy], meta: { part, dy } });
}
function headVariants(view, base) {
  const side = view === 'side', back = view === 'back';
  cs(`char.${view}.head`, [base], 'head');
  if (back) return;
  const b = base.slice(); b[3] = side ? '..HHSSSS.' : '..SSSSSS..'; cs(`char.${view}.head.blink`, [b], 'head');
  const s = base.slice(); s[3] = side ? '..HHSSsS.' : '..SsSSsS..'; cs(`char.${view}.head.sleep`, [s], 'head');
  if (!side) {
    const t = base.slice(); t[4] = '..SSmmSS..'; cs(`char.${view}.head.talk`, [t], 'head');
    const c = base.slice(); c[3] = '..SEEEES..'; c[4] = '..SSmmSS..'; c[5] = '...SmmS...'; cs(`char.${view}.head.scream`, [c], 'head');
  }
}
headVariants('front', X.HEAD_F); headVariants('side', X.HEAD_S); headVariants('back', X.HEAD_B);
for (const v of ['front', 'back']) {
  cs(`char.${v}.body`, [X.BODY_F], 'body'); cs(`char.${v}.body.seat`, [X.BODY_SEAT], 'body'); cs(`char.${v}.body.up`, [X.BODY_UP], 'body');
  cs(`char.${v}.legs`, X.LEGS_F.map((f) => f), 'legs');
}
cs('char.side.body', [X.BODY_S], 'body');
cs('char.side.legs', X.LEGS_S, 'legs');
for (const s of csprites) if (s.name.endsWith('.legs')) s.tags = { stand: [0, 0], step: [1, 2] };
csprites.push({ name: 'char.mini', w: 6, h: 8, palette: palOf([X.MINI]), frames: [X.MINI], anchor: [3, 8], meta: { part: 'whole', note: 'subagente' } });
const hairOv = (nm, idx) => ({ name: nm, views: {
  front: X.HAIRX.F[idx].map((q) => [q[0], q[1], 'H']), side: X.HAIRX.S[idx].map((q) => [q[0], q[1], 'H']), back: X.HAIRX.F[idx].map((q) => [q[0], q[1], 'H']) } });
const armsUp = [[0, 4, 'S'], [9, 4, 'S'], [0, 5, 'b'], [9, 5, 'b']];
out('characters.px.json', { px: 1, sprites: csprites, overlays: [
  hairOv('hair.long', 1), hairOv('hair.bun', 2),
  { name: 'char.arms.up', views: { front: armsUp, back: armsUp } },
  { name: 'char.hand.a', views: { side: [[4, 9, 'S']] } }, { name: 'char.hand.b', views: { side: [[6, 9, 'S']] } },
] });

// ================= accessories =================
const A = X.ACCX;
const ov = (name, id, f) => ({ name, views: { front: A.F[id].filter(f), side: A.S[id].filter(f), back: A.B[id].filter(f) } });
const hat = (q) => q[1] <= 1, vest = (q) => q[1] === 8;
const acc = [ov('acc.headphones', 'personal', () => true), ov('acc.tie', 'work', () => true), ov('acc.cap', 'plus', () => true),
  ov('acc.hardhat', 'builder', hat), ov('acc.vest', 'builder', vest)];
const asp = [];
const mk = (name, recs, meta, extra = {}) => asp.push({ ...toSprite(name, recs, extra), meta });
// meta.at = esquina sup. izq. del objeto relativa a la esquina del personaje 10x14 (sin voltear), por vista.
mk('item.briefcase', [one(8, 8, 0, 0, (g) => { R(g, 0, 0, 4, 3, '#6b4329'); R(g, 0, 0, 4, 1, '#8a5a3a'); R(g, 1, 1, 2, 1, '#c9a06a'); })],
  { at: { front: [7, 10], back: [7, 10], side: [3, 10], 'side.hand': [5, 10], 'side.flip': [4, 10], 'side.hand.flip': [2, 10] }, note: 'maletin' });
mk('item.briefcase.seated', [one(8, 8, 0, 0, (g) => { R(g, 0, 1, 4, 3, '#6b4329'); R(g, 0, 1, 4, 1, '#8a5a3a'); R(g, 1, 0, 2, 1, '#3e2616'); })],
  { at: 'desk', dx: -4, dy: 6 });
mk('item.coffee', [one(6, 6, 0, 0, (g) => { R(g, 0, 0, 2, 3, '#f4efe6'); R(g, 0, 0, 2, 1, '#6b4329'); })],
  { at: { front: [8, 7], back: [8, 7], side: [4, 7], 'side.hand': [6, 7], 'side.flip': [5, 7], 'side.hand.flip': [3, 7] }, steam: { color: '#ffffff', alpha: 0.6, fps: 3 }, note: 'cafe' });
mk('item.coffee.seated', [one(4, 4, 0, 0, (g) => { R(g, 0, 0, 2, 2, '#f4efe6'); R(g, 0, 0, 2, 1, '#6b4329'); })],
  { at: 'desk', dx: 11, dy: -2, steam: { color: '#ffffff', alpha: 0.7 } });
mk('item.backpack.front', [one(8, 4, 0, 0, (g) => { R(g, 0, 0, 1, 2, '#25916c'); R(g, 5, 0, 1, 2, '#25916c'); })], { at: { front: [2, 6] }, note: 'tirantes' });
mk('item.backpack.back', [one(6, 6, 0, 0, (g) => { R(g, 0, 0, 4, 4, '#3fc79a'); R(g, 0, 0, 4, 1, '#25916c'); R(g, 1, 2, 2, 1, '#25916c'); })], { at: { back: [3, 6] } });
mk('item.backpack.side', [one(4, 6, 0, 0, (g) => { R(g, 0, 0, 2, 4, '#3fc79a'); R(g, 0, 0, 2, 1, '#25916c'); })], { at: { side: [1, 6], 'side.flip': [7, 6] } });
mk('item.backpack.seated', [one(4, 7, 0, 0, (g) => { R(g, 0, 0, 2, 5, '#3fc79a'); R(g, 0, 0, 2, 1, '#25916c'); })], { at: 'desk', dx: 1, dy: -6 });
// martillo del constructor: hx = x+9 del personaje
mk('item.hammer.up', [one(10, 12, 2, 2, (g) => { R(g, 0, 2, 1, 5, '#8a5a3a'); R(g, -1, 0, 3, 2, '#8f96a3'); })], { at: { front: [9, 4] }, note: 'origen del sprite = (hx, y+2)' });
mk('item.hammer.down', [one(8, 8, 0, 0, (g) => { R(g, 0, 0, 3, 1, '#8a5a3a'); R(g, 2, 0, 2, 3, '#8f96a3'); R(g, 4, 3, 1, 1, '#ffd23f'); R(g, 3, 4, 1, 1, '#fff6c9'); R(g, 5, 2, 1, 1, '#fff6c9'); })], { at: { front: [9, 9] } });
out('accessories.px.json', { px: 1, sprites: asp, overlays: acc });

// ================= props =================
const ps = [];
const add = (name, recs, meta, extra) => ps.push({ ...toSprite(name, recs, extra), meta });
add('prop.desk', [one(40, 30, 8, 8, (g) => { X.drawDesk(g, 0, 0); R(g, 3, 0, 7, 1, '#c08a5c'); R(g, 3, 1, 7, 1, '#a8744c'); })], { note: 'mesa 24x11 sin teclado; origen = esquina sup. izq.' });
add('prop.keyboard', [one(10, 4, 0, 0, (g) => { R(g, 0, 0, 7, 1, '#d5d9e0'); R(g, 0, 1, 7, 1, '#8f96a3'); })], { at: [3, 0], note: 'relativo a la esquina de la mesa' });
add('prop.chair', [one(20, 20, 4, 10, (g) => X.drawChair(g, 0, 0))], { note: 'origen = (cx, dy) de drawChair' });
add('prop.monitor.frame', [one(20, 20, 4, 4, (g) => { R(g, 0, 0, 10, 7, '#2a2733'); R(g, 4, 7, 2, 1, '#2a2733'); R(g, 3, 8, 4, 1, '#3b3846'); })], { screen: [1, 1, 8, 5], note: 'pantalla animada en el plugin (fx.monitor)' });
add('prop.door.closed', [one(30, 30, 6, 6, (g) => X.drawDoor(g, 0, 0, false, 0))], {});
add('prop.door.open', [one(30, 30, 6, 6, (g) => X.drawDoor(g, 0, 0, true, 0))], {});
add('prop.sofa', [one(40, 20, 6, 4, (g) => X.drawSofa(g, 0, 0))], { place: 'floor' });
add('prop.plant', [one(20, 20, 4, 4, (g) => X.drawPlant(g, 0, 0))], { place: 'floor' });
add('prop.cooler', [one(20, 30, 4, 4, (g) => X.drawCooler(g, 0, 0))], { place: 'floor', note: 'dispensador; la burbuja se anima en plugin' });
add('prop.table', [one(30, 20, 4, 4, (g) => X.drawDeco(g, { id: 'table', x: 0, y: 0 }, 0))], { place: 'floor', note: 'mesita' });
add('prop.shelf', [one(30, 30, 4, 4, (g) => X.drawDeco(g, { id: 'shelf', x: 0, y: 0 }, 0))], { place: 'floor', note: 'estantería' });
add('prop.lamp', [one(20, 30, 4, 4, (g) => { X.drawDeco(g, { id: 'lamp', x: 0, y: 0 }, 0); })], { place: 'floor', glow: 'rgba(255,241,168,0.25) 7x2 en (-1,5)' });
add('prop.rack', [one(30, 40, 4, 4, (g) => X.drawRack(g, 0, 0))], { place: 'floor' });
for (const [sn, S] of Object.entries(X.SEASONS)) {
  for (const kind of [0, 1, 2]) add(`tree.${kind}.${sn}`, [one(30, 30, 6, 6, (g) => X.drawTree(g, { x: 0, y: 0, kind }, S))], { place: 'floor', kind: kind === 1 ? 'pine' : kind === 2 ? 'autumn' : 'round', season: sn });
  add(`bush.${sn}`, [one(14, 14, 3, 3, (g) => { R(g, 0, 1, 8, 4, S.cd); R(g, 1, 0, 6, 4, S.c); R(g, 2, 0, 2, 1, S.ch); R(g, 1, 5, 6, 1, 'rgba(0,0,0,0.25)'); })], { place: 'floor', season: sn });
}
add('prop.piggy', [one(30, 20, 4, 4, (g) => X.spr(g, X.PIG, 0, 0, X.PIGPAL, false))], { note: 'cerdito-hucha 15x9' });
add('prop.coin', [one(10, 10, 2, 2, (g) => X.coin(g, 0, 0))], {});
add('prop.coin.small', [one(6, 6, 1, 1, (g) => { R(g, 0, 0, 3, 3, '#b8860b'); R(g, 0, 0, 3, 1, '#f5c542'); R(g, 1, 1, 1, 1, '#fff1a8'); })], { note: 'moneda que cae a la hucha' });
add('prop.tomb', [one(30, 30, 4, 4, (g) => X.drawTomb(g, 0, 0))], { note: 'lápida' });
ps.push({ name: 'prop.ghost', w: 9, h: 9, palette: { W: '#f2f4ff', E: OL, O: '#3a3346' }, frames: X.GHOST.map((f) => f.map((r) => r.padEnd(9, '.'))), fps: 4, anchor: [0, 0], meta: { alpha: [0.4, 0.9], bob: 2 } });
const LIGHT = { run: '#58e1f0', fire: '#ff5a3c', frozen: '#9fdcff', dead: '#6b6f78', empty: '#2a3138' };
const GC = { run: '#7fd8e8', fire: '#ffd23f', frozen: '#ffffff', dead: '#59606a' };
for (const st of Object.keys(LIGHT)) {
  add(`pod.base.${st}`, [one(30, 10, 4, 4, (g) => { R(g, 0, 0, 22, 4, '#4a5560'); R(g, 0, 0, 22, 1, '#5f6b77'); R(g, 3, 2, 16, 1, LIGHT[st]); })], { note: 'zócalo; origen = (px, py+26); fire parpadea a #ffd23f' });
  add(`pod.back.${st}`, [one(40, 40, 4, 4, (g) => {
    R(g, 1, 2, 20, 24, st === 'frozen' ? '#d9f3fb' : st === 'dead' || st === 'empty' ? '#14191e' : '#1f2a33');
    R(g, 2, 20, 18, 2, st === 'empty' ? '#3a424b' : '#5c6670');
  })], { note: 'interior y suelo: ANTES del personaje; origen = (px, py)' });
  add(`pod.front.${st}`, [one(40, 40, 8, 8, (g) => {
    if (st === 'empty') {
      R(g, 2, 0, 18, 1, '#3d5560'); R(g, 0, 2, 1, 24, '#3d5560'); R(g, 21, 2, 1, 24, '#3d5560'); R(g, 1, 1, 1, 1, '#3d5560'); R(g, 20, 1, 1, 1, '#3d5560'); return;
    }
    const gc = GC[st];
    R(g, 2, 0, 18, 1, gc); R(g, 1, 1, 1, 1, gc); R(g, 20, 1, 1, 1, gc);
    if (st === 'dead') {
      R(g, 0, 2, 1, 7, gc); R(g, 0, 13, 1, 13, gc); R(g, 21, 2, 1, 15, gc); R(g, 21, 21, 1, 5, gc);
      R(g, -2, 29, 2, 1, '#7fd8e8'); R(g, 23, 28, 1, 1, '#7fd8e8'); R(g, 24, 29, 2, 1, '#7fd8e8');
    } else { R(g, 0, 2, 1, 24, gc); R(g, 21, 2, 1, 24, gc); R(g, 2, 3, 1, 6, 'rgba(255,255,255,0.35)'); }
    if (st === 'frozen') { R(g, 1, 2, 3, 1, '#ffffff'); R(g, 1, 3, 1, 2, '#ffffff'); R(g, 18, 2, 3, 1, '#ffffff'); R(g, 20, 3, 1, 2, '#ffffff'); }
  })], { note: 'cristal y marco: DESPUÉS del personaje; origen = (px, py); fire parpadea #ff9a5c/#ffd23f' });
}
// bocadillos: se dibujan en la esquina sup. izq. (anchor 0,0); meta.at = posición relativa a la esquina del personaje sentado
const thinkF = [0, 1, 2, 3].map((n) => fixed(11, 9, 0, 0, (g) => { X.bubble(g, 0, 0, 11, 7, '#ffffff'); for (let i = 0; i < n; i++) R(g, 2 + i * 3, 3, 1, 1, OL); }));
add('bubble.think', thinkF, { at: [7, -9], note: 'frame = nº de puntos; ciclo floor(t*3)%4' }, { fps: 3, anchor: [0, 0] });
add('bubble.wait', [fixed(7, 11, 0, 0, (g) => { X.bubble(g, 0, 0, 7, 9, '#ffd23f'); R(g, 3, 2, 1, 3, OL); R(g, 3, 6, 1, 1, OL); })], { at: [8, -11], bob: 1, note: 'sube 1px cada 0.25s' }, { anchor: [0, 0] });
const talkF = []; for (let k = 0; k < 8; k++) talkF.push(fixed(12, 9, 0, 0, (g) => { X.bubble(g, 0, 0, 12, 7, '#ffffff'); R(g, 2, 2, 3 + X.hash(k) % 6, 1, OL); R(g, 2, 4, 2 + X.hash(k + 7) % 5, 1, '#8a8399'); }));
add('bubble.talk', talkF, { at: [7, -9], note: 'frame k = floor(t*5) % 8' }, { fps: 5, anchor: [0, 0] });
out('props.px.json', { px: 1, sprites: ps });

// ================= pop =================
const pp = [];
for (const [id, d] of Object.entries(pop.POP_DECO)) pp.push({ name: `deco.${id}`, w: d.w, h: d.h, palette: d.pal, frames: d.frames, ...(d.fps ? { fps: d.fps } : {}), meta: { place: d.place, kind: 'deco', label: d.name } });
for (const [id, d] of Object.entries(pop.POP_EMOJI)) pp.push({ name: `emoji.${id}`, w: 9, h: 9, palette: d.pal, frames: d.frames, ...(d.fps ? { fps: d.fps } : {}), meta: { place: 'floor', kind: 'emoji', label: d.name } });
out('pop.px.json', { px: 1, sprites: pp });
console.log('deco', Object.keys(pop.POP_DECO).length, 'emoji', Object.keys(pop.POP_EMOJI).length);

// ================= font =================
const glyphs = Object.keys(X.FONT);
const fr = glyphs.map((ch) => { const s = X.FONT[ch]; return [0, 1, 2, 3, 4].map((r) => [0, 1, 2].map((c) => (s[r * 3 + c] === '1' ? '#' : '.')).join('')); });
out('font.px.json', { px: 1, sprites: [{ name: 'font.3x5', w: 3, h: 5, palette: { '#': '#ffffff' }, frames: fr, meta: { glyphs: glyphs.join(''), advance: 4, note: 'un frame por glifo; texto en MAYÚSCULAS' } }] });
console.log('glyphs', glyphs.length);
