#!/usr/bin/env node
// Genera assets/contact-sheet.png: todos los sprites de assets/*.px.json (cada frame, ampliado)
// y los overlays montados sobre el personaje, para revisarlos a ojo. Sin dependencias: PNG propio con node:zlib.
//   node scripts/contact-sheet.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const SHEET_W = 1280;
const SCALE = 3;
const PAD = 6;
const BG = [38, 32, 52, 255];
const CELL_BG = [58, 51, 78, 255];
const LABEL = [233, 242, 247, 255];
const HEAD = [255, 233, 168, 255];

// ---------- PNG ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- colors ----------
function parseColor(c) {
  if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
  const m = c.match(/rgba\(([^)]*)\)/)[1].split(',').map(Number);
  return [m[0], m[1], m[2], Math.round(m[3] * 255)];
}

// ---------- load ----------
const files = readdirSync(ASSETS).filter((f) => f.endsWith('.px.json')).sort();
const data = files.map((f) => ({ file: f, ...JSON.parse(readFileSync(join(ASSETS, f), 'utf8')) }));
const font = data.flatMap((d) => d.sprites).find((s) => s.name === 'font.3x5');
const GLYPHS = font.meta.glyphs;

// ---------- layout: list of blocks, then paint ----------
// block: { label, w, h, draw(put, ox, oy) } where put(x,y,[r,g,b,a]) paints one source pixel (already scaled by the caller)
const sections = [];
function spriteBlock(s) {
  const fw = s.w * SCALE + 2;
  const w = s.frames.length * fw + (s.frames.length - 1) * 2;
  return {
    label: `${s.name} ${s.w}x${s.h}${s.frames.length > 1 ? ` x${s.frames.length}` : ''}`, w, h: s.h * SCALE,
    paint(img, ox, oy) {
      s.frames.forEach((fr, fi) => {
        const x0 = ox + fi * (fw + 2);
        img.rect(x0, oy, fw, s.h * SCALE, CELL_BG);
        fr.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch !== '.') img.rect(x0 + 1 + rx * SCALE, oy + ry * SCALE, SCALE, SCALE, parseColor(s.palette[ch])); }));
      });
    },
  };
}
const byName = new Map(data.flatMap((d) => d.sprites).map((s) => [s.name, s]));
// personaje montado (10x14 + 3 filas de margen arriba) con un overlay
function overlayBlock(o, view) {
  const parts = view === 'side' ? ['char.side.head', 'char.side.body', 'char.side.legs'] : [`char.${view}.head`, `char.${view}.body`, `char.${view}.legs`];
  const px = new Map();
  parts.forEach((n, i) => {
    const s = byName.get(n); const dy = [0, 6, 10][i];
    s.frames[0].forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch !== '.') px.set(`${rx},${dy + ry}`, s.palette[ch]); }));
  });
  const pal = byName.get('char.front.head').palette;
  const full = { ...byName.get('char.front.body').palette, ...pal, ...byName.get('char.front.legs').palette, ...byName.get('char.front.head.blink').palette, A: '#dfe7f7', a: '#6fa3ff', C: '#3fc79a', c: '#25916c', T: '#7a1e2c', W: '#f4efe6' };
  const pts = o.views[view] ?? [];
  return {
    label: `${o.name} (${view})`, w: 10 * SCALE + 2, h: 17 * SCALE,
    paint(img, ox, oy) {
      img.rect(ox, oy, 10 * SCALE + 2, 17 * SCALE, CELL_BG);
      for (const [k, c] of px) { const [x, y] = k.split(',').map(Number); img.rect(ox + 1 + x * SCALE, oy + (y + 3) * SCALE, SCALE, SCALE, parseColor(c)); }
      for (const [x, y, key] of pts) img.rect(ox + 1 + x * SCALE, oy + (y + 3) * SCALE, SCALE, SCALE, parseColor(full[key] ?? '#ff00ff'));
    },
  };
}
for (const d of data) {
  sections.push({ title: d.file, blocks: d.sprites.filter((s) => s.name !== 'font.3x5').map(spriteBlock).concat(d.sprites.filter((s) => s.name === 'font.3x5').map(spriteBlock)) });
  if (d.overlays?.length) sections.push({ title: `${d.file} overlays`, blocks: d.overlays.flatMap((o) => Object.keys(o.views).map((v) => overlayBlock(o, v))) });
}

// ---------- paint ----------
function textWidth(s) { return s.length * 4 - 1; }
function layout() {
  const items = []; let y = PAD;
  for (const sec of sections) {
    items.push({ kind: 'title', text: sec.title, x: PAD, y }); y += 9 + PAD;
    let x = PAD, rowH = 0, row = [];
    const flush = () => { if (!row.length) return; for (const r of row) items.push({ kind: 'block', ...r, y }); y += rowH + 8 + PAD; row = []; x = PAD; rowH = 0; };
    for (const b of sec.blocks) {
      const cw = Math.max(b.w, textWidth(b.label.toUpperCase()));
      if (x + cw + PAD > SHEET_W) flush();
      row.push({ b, x, cw }); x += cw + PAD; rowH = Math.max(rowH, b.h);
    }
    flush(); y += PAD;
  }
  return { items, height: y };
}
const { items, height } = layout();
const buf = Buffer.alloc(SHEET_W * height * 4);
const img = {
  rect(x, y, w, h, c) {
    for (let j = Math.max(0, y); j < Math.min(height, y + h); j++) for (let i = Math.max(0, x); i < Math.min(SHEET_W, x + w); i++) {
      const o = (j * SHEET_W + i) * 4, a = c[3] / 255;
      for (let k = 0; k < 3; k++) buf[o + k] = Math.round(buf[o + k] * (1 - a) + c[k] * a);
      buf[o + 3] = 255;
    }
  },
  text(s, x, y, c) {
    [...s.toUpperCase()].forEach((ch, i) => {
      const gi = GLYPHS.indexOf(ch); if (gi < 0) return;
      font.frames[gi].forEach((row, r) => { for (let k = 0; k < 3; k++) if (row[k] === '#') img.rect(x + i * 4 + k, y + r, 1, 1, c); });
    });
  },
};
img.rect(0, 0, SHEET_W, height, BG);
for (const it of items) {
  if (it.kind === 'title') img.text(it.text, it.x, it.y, HEAD);
  else { it.b.paint(img, it.x, it.y); img.text(it.b.label, it.x, it.y + it.b.h + 2, LABEL); }
}
const out = join(ASSETS, 'contact-sheet.png');
writeFileSync(out, encodePng(SHEET_W, height, buf));
console.log(`${out}: ${SHEET_W}x${height}, ${items.filter((i) => i.kind === 'block').length} bloques`);
