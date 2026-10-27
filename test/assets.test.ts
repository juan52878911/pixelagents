import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CHARACTER_KEYS, type PxFile, type PxSprite } from '@pixelagents/protocol';
import { FX, GAGS, fire, smoke, beam, poof, thermo, monitor, type MonitorState, type Painter } from '../plugins/pop/src/client/index.js';

const ROOT = join(import.meta.dirname, '..');
const ASSETS = join(ROOT, 'assets');
const COLOR = /^(#[0-9a-fA-F]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/;
const files = readdirSync(ASSETS).filter((f) => f.endsWith('.px.json')).sort();
const loaded = files.map((f) => ({ file: f, data: JSON.parse(readFileSync(join(ASSETS, f), 'utf8')) as PxFile }));
const allSprites: PxSprite[] = loaded.flatMap((l) => l.data.sprites);
const allOverlays = loaded.flatMap((l) => l.data.overlays ?? []);

describe('assets: .px.json files', () => {
  it('has the expected files', () => {
    expect(files).toEqual(['accessories.px.json', 'characters.px.json', 'font.px.json', 'pop.px.json', 'props.px.json']);
  });

  for (const { file, data } of loaded) {
    describe(file, () => {
      it('is a PxFile v1', () => {
        expect(data.px).toBe(1);
        expect(Array.isArray(data.sprites)).toBe(true);
      });
      for (const s of data.sprites) {
        it(`sprite ${s.name} is well formed`, () => {
          expect(s.name).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/);
          expect(Number.isInteger(s.w) && s.w > 0).toBe(true);
          expect(Number.isInteger(s.h) && s.h > 0).toBe(true);
          expect(s.frames.length).toBeGreaterThan(0);
          for (const [k, c] of Object.entries(s.palette)) {
            expect(k.length, `palette key '${k}'`).toBe(1);
            expect(k).not.toBe('.');
            expect(c, `color ${k}`).toMatch(COLOR);
          }
          s.frames.forEach((f, fi) => {
            expect(f.length, `${s.name} frame ${fi}: rows`).toBe(s.h);
            f.forEach((row, ri) => {
              expect(row.length, `${s.name} frame ${fi} row ${ri}: width`).toBe(s.w);
              for (const ch of row) if (ch !== '.') expect(s.palette[ch], `${s.name} frame ${fi} row ${ri}: '${ch}' not in palette`).toBeDefined();
            });
          });
          if (s.fps !== undefined) expect(s.fps).toBeGreaterThanOrEqual(0);
          if (s.fps && s.fps > 0) expect(s.frames.length).toBeGreaterThan(1);
          if (s.anchor) expect(s.anchor.every((n) => Number.isInteger(n))).toBe(true);
          for (const [tag, [a, b]] of Object.entries(s.tags ?? {})) {
            expect(a, tag).toBeGreaterThanOrEqual(0);
            expect(b, tag).toBeLessThan(s.frames.length);
            expect(a).toBeLessThanOrEqual(b);
          }
        });
      }
      for (const o of data.overlays ?? []) {
        it(`overlay ${o.name} stays inside the 10x14 character box`, () => {
          expect(Object.keys(o.views).length).toBeGreaterThan(0);
          for (const [view, pts] of Object.entries(o.views)) {
            expect(['front', 'side', 'back']).toContain(view);
            for (const [x, y, key] of pts) {
              expect(x, `${o.name}.${view} x`).toBeGreaterThanOrEqual(0);
              expect(x, `${o.name}.${view} x`).toBeLessThan(10);
              // headgear (caps, buns) sits up to 3 px above the 10x14 box
              expect(y, `${o.name}.${view} y`).toBeGreaterThanOrEqual(-3);
              expect(y, `${o.name}.${view} y`).toBeLessThan(14);
              expect(Object.keys(CHARACTER_KEYS), `${o.name} key ${key}`).toContain(key);
            }
          }
        });
      }
    });
  }

  it('sprite names are unique across files (and distinct from overlay names)', () => {
    const names = allSprites.map((s) => s.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    const ov = allOverlays.map((o) => o.name);
    expect(ov.filter((n, i) => ov.indexOf(n) !== i)).toEqual([]);
    expect(ov.filter((n) => names.includes(n))).toEqual([]);
  });

  it('has the required inventory', () => {
    const names = new Set(allSprites.map((s) => s.name));
    const need = [
      'char.front.head', 'char.front.head.blink', 'char.front.head.talk', 'char.front.head.sleep', 'char.front.head.scream',
      'char.front.body', 'char.front.body.seat', 'char.front.body.up', 'char.front.legs',
      'char.side.head', 'char.side.body', 'char.side.legs', 'char.back.head', 'char.back.body', 'char.back.legs', 'char.mini',
      'prop.desk', 'prop.chair', 'prop.monitor.frame', 'prop.keyboard', 'prop.door.open', 'prop.door.closed', 'prop.sofa', 'prop.plant',
      'prop.cooler', 'prop.table', 'prop.shelf', 'prop.lamp', 'prop.rack', 'prop.piggy', 'prop.coin', 'prop.tomb', 'prop.ghost',
      'bubble.think', 'bubble.wait', 'bubble.talk', 'item.briefcase', 'item.coffee', 'item.backpack.front', 'font.3x5',
      ...['run', 'fire', 'frozen', 'dead', 'empty'].flatMap((st) => [`pod.base.${st}`, `pod.back.${st}`, `pod.front.${st}`]),
      ...['verano', 'otono', 'invierno'].flatMap((s) => [0, 1, 2].map((k) => `tree.${k}.${s}`).concat(`bush.${s}`)),
    ];
    expect(need.filter((n) => !names.has(n))).toEqual([]);
    const ov = new Set(allOverlays.map((o) => o.name));
    for (const n of ['hair.long', 'hair.bun', 'acc.headphones', 'acc.tie', 'acc.cap', 'acc.hardhat', 'acc.vest']) expect(ov.has(n), n).toBe(true);
  });

  it('pop.px.json holds 18 decorations and 15 emojis with place/kind metadata', () => {
    const pop = loaded.find((l) => l.file === 'pop.px.json')!.data.sprites;
    const deco = pop.filter((s) => s.meta?.kind === 'deco');
    const emoji = pop.filter((s) => s.meta?.kind === 'emoji');
    expect(deco).toHaveLength(18);
    expect(emoji).toHaveLength(15);
    for (const s of deco) {
      expect(['wall', 'floor']).toContain(s.meta?.place);
      if (s.meta?.place === 'wall') { expect(s.h).toBeLessThanOrEqual(12); expect(s.w).toBeLessThanOrEqual(16); }
      else { expect(s.w).toBeLessThanOrEqual(18); expect(s.h).toBeLessThanOrEqual(20); }
    }
    for (const s of emoji) { expect(s.w).toBe(9); expect(s.h).toBe(9); expect(['wall', 'floor']).toContain(s.meta?.place); }
  });

  it('font has one 3x5 frame per glyph and the glyph order in meta', () => {
    const font = allSprites.find((s) => s.name === 'font.3x5')!;
    const glyphs = font.meta?.glyphs as string;
    expect([...glyphs]).toHaveLength(font.frames.length);
    expect(new Set([...glyphs]).size).toBe(font.frames.length);
    expect(font.w).toBe(3);
    expect(font.h).toBe(5);
  });
});

describe('assets: animations.json', () => {
  const anim = JSON.parse(readFileSync(join(ASSETS, 'animations.json'), 'utf8')) as {
    behaviors: Record<string, unknown>; accounts: Record<string, unknown>;
  };
  const sprites = new Set(allSprites.map((s) => s.name));
  const overlays = new Set(allOverlays.map((o) => o.name));
  const REF_KEYS = new Set(['sprite', 'head', 'body', 'legs', 'blinkHead', 'talkHead', 'bubble', 'item', 'items', 'seated', 'door', 'overlay',
    'overlays', 'handOverlays', 'hammerUp', 'hammerDown']);

  function refs(node: unknown, inRef: boolean, out: string[]): void {
    if (typeof node === 'string') { if (inRef) out.push(node); return; }
    if (Array.isArray(node)) { for (const n of node) refs(n, inRef, out); return; }
    if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) refs(v, inRef || REF_KEYS.has(k), out);
  }

  it('defines the default behaviors', () => {
    for (const b of ['type', 'think', 'wait', 'idle', 'sleep', 'walk', 'talk', 'arrive', 'leave', 'minion', 'poof']) expect(anim.behaviors[b], b).toBeDefined();
  });
  it('only references existing sprites, overlays and fx', () => {
    const found: string[] = [];
    refs(anim, false, found);
    expect(found.length).toBeGreaterThan(20);
    expect(found.filter((n) => !sprites.has(n) && !overlays.has(n))).toEqual([]);
    const fxRefs = Object.values(anim.behaviors as Record<string, { fx?: string }>).map((b) => b.fx).filter((x): x is string => !!x);
    expect(fxRefs.filter((f) => !(f in FX))).toEqual([]);
  });
});

// ---- gags and fx on a fake Painter ----
interface Op { x: number; y: number; w: number; h: number; c: string; a: number }

const FONT_SPRITE = allSprites.find((s) => s.name === 'font.3x5')!;
const GLYPHS = FONT_SPRITE.meta!.glyphs as string;

function makePainter() {
  const ops: Op[] = [];
  let alpha = 1;
  let nonInt = 0;
  const ints = (...n: number[]) => { for (const v of n) if (!Number.isInteger(v)) nonInt++; };
  const rec = (x: number, y: number, w: number, h: number, c: string) => ops.push({ x, y, w, h, c, a: alpha });
  const p: Painter = {
    px(x, y, c) { ints(x, y); rec(x, y, 1, 1, c); },
    rect(x, y, w, h, c) { ints(x, y, w, h); rec(x, y, w, h, c); },
    sprite(rows, x, y, pal, flip) {
      ints(x, y);
      rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) { const col = pal[row[c]!]; if (col) rec(x + (flip ? row.length - 1 - c : c), y + r, 1, 1, col); }
      });
    },
    text(s, x, y, c, sc = 1) {
      ints(x, y);
      const up = s.toUpperCase();
      if (![...up].every((ch) => GLYPHS.includes(ch))) throw new Error(`glyph outside the font: ${s}`);
      [...up].forEach((ch, i) => {
        const fr = FONT_SPRITE.frames[GLYPHS.indexOf(ch)]!;
        fr.forEach((row, r) => { for (let k = 0; k < 3; k++) if (row[k] === '#') rec(x + (i * 4 + k) * sc, y + r * sc, sc, sc, c); });
      });
    },
    alpha(a) { alpha = a; },
  };
  return { p, ops, get nonInt() { return nonInt; }, resetAlpha() { alpha = 1; } };
}

const PS = [0, 0.25, 0.5, 0.75, 1];
const TS = [0, 0.37, 1.23, 7.77, 100.5];
const ORIGINS: [number, number][] = [[100, 100], [37, 53], [0, 26]];

describe('plugins/pop: gags', () => {
  it('has the 8 gags of the prototype', () => {
    expect(Object.keys(GAGS).sort()).toEqual(['bloque', 'espada', 'fantasma', 'invader', 'lvup', 'seta', 'tetris', 'tuberia']);
  });
  for (const [id, gag] of Object.entries(GAGS)) {
    it(`${id} runs for p in {0,.25,.5,.75,1} inside its box with integer coordinates`, () => {
      expect(gag.name).toBeTruthy();
      expect(gag.dur).toBeGreaterThan(0);
      let drew = 0;
      for (const [x, y] of ORIGINS) for (const p of PS) for (const t of TS) {
        if (gag.pose) {
          const po = gag.pose(p);
          if (po.lift !== undefined) expect(Number.isInteger(po.lift)).toBe(true);
          if (po.arms !== undefined) expect(po.arms).toBe('up');
        }
        const m = makePainter();
        gag.draw(m.p, x, y, p, t);
        expect(m.nonInt, `${id} p=${p} t=${t}`).toBe(0);
        for (const r of m.ops) {
          expect(r.w > 0 && r.h > 0).toBe(true);
          expect(r.c).toMatch(COLOR);
          const inBox = r.x >= x - 10 && r.x + r.w <= x + 20 && r.y >= y - 26 && r.y + r.h <= y + 12;
          expect(inBox, `${id} p=${p} t=${t}: (${r.x - x},${r.y - y},${r.w}x${r.h}) outside the box`).toBe(true);
        }
        drew += m.ops.length;
      }
      expect(drew).toBeGreaterThan(0);
    });
  }
});

describe('plugins/pop: fx', () => {
  it('has fire, smoke, ice, beam, poof (+ thermo, monitor)', () => {
    for (const n of ['fire', 'smoke', 'ice', 'beam', 'poof', 'thermo', 'monitor']) expect(FX[n], n).toBeDefined();
  });
  for (const [id, fx] of Object.entries(FX)) {
    it(`${id} runs for p in {0,.25,.5,.75,1} inside its box with integer coordinates`, () => {
      let drew = 0;
      for (const [x, y] of ORIGINS) for (const p of PS) for (const t of TS) {
        const m = makePainter();
        fx.draw(m.p, x, y, p, t);
        expect(m.nonInt, `${id} p=${p} t=${t}`).toBe(0);
        const [x0, y0, x1, y1] = fx.box;
        for (const r of m.ops) {
          expect(r.c).toMatch(COLOR);
          expect(r.a).toBeGreaterThanOrEqual(0);
          expect(r.a).toBeLessThanOrEqual(1);
          const inBox = r.x >= x + x0 && r.x + r.w <= x + x1 && r.y >= y + y0 && r.y + r.h <= y + y1;
          expect(inBox, `${id} p=${p} t=${t}: (${r.x - x},${r.y - y},${r.w}x${r.h}) outside ${fx.box.join(',')}`).toBe(true);
        }
        drew += m.ops.length;
      }
      expect(drew).toBeGreaterThan(0);
    });
  }
});

// ---- fidelity: the TS port draws exactly what the prototype draws ----
describe('plugins/pop: fidelity against design/prototype', () => {
  const PROTO = join(ROOT, 'design', 'prototype');

  function protoRecorder() {
    const ops: Op[] = [];
    const g = { fillStyle: '#000', globalAlpha: 1, fillRect(x: number, y: number, w: number, h: number) { ops.push({ x, y, w, h, c: this.fillStyle, a: this.globalAlpha }); } };
    return { g, ops };
  }
  const FONT_SRC = readFileSync(join(PROTO, 'prototype.html'), 'utf8').split('\n');
  const slice = (a: number, b: number) => FONT_SRC.slice(a - 1, b).join('\n');
  const popSrc = readFileSync(join(PROTO, 'pop.js'), 'utf8');
  const engine = vm.runInNewContext(`${slice(8, 41)}\n({ R, spr, txt, hash, OL })`) as {
    R: (...a: unknown[]) => void; spr: (...a: unknown[]) => void; txt: (...a: unknown[]) => void; hash: (n: number) => number; OL: string;
  };
  const protoGags = vm.runInNewContext(`${popSrc}\n POP_GAGS`, engine) as Record<string, {
    draw(g: unknown, x: number, y: number, p: number, t: number): void; pose?(p: number): unknown; dur: number; name: string;
  }>;
  // The prototype's drawMonitor/drawBeam use signed `>>` on a 32-bit unsigned hash, which can give negative widths
  // and undefined colors for hashes >= 2^31. The port uses `>>>`; patch the prototype the same way to compare.
  const fxSrc = `${slice(8, 41)}\n${slice(1237, 1260)}\n${slice(1261, 1270)}\n${slice(1282, 1304)}\n${slice(1431, 1448)}`.replace(/(?<!>)>> (\d)/g, '>>> $1');
  const protoFx = vm.runInNewContext(`${fxSrc}\n({ drawMonitor, drawThermo, drawFire, drawSmoke, drawBeam, drawPoof })`) as Record<string, (...a: unknown[]) => void>;

  const sameOps = (a: Op[], b: Op[], label: string) => expect(b, label).toEqual(a);

  for (const id of Object.keys(GAGS)) {
    it(`gag ${id} is identical to pop.js`, () => {
      const proto = protoGags[id]!;
      expect(GAGS[id]!.dur).toBe(proto.dur);
      expect(GAGS[id]!.name).toBe(proto.name);
      for (const p of [...PS, 0.1, 0.33, 0.61, 0.95]) {
        if (proto.pose) expect(GAGS[id]!.pose!(p)).toEqual(proto.pose(p));
        for (const t of TS) {
          const a = protoRecorder(); proto.draw(a.g, 40, 60, p, t);
          const b = makePainter(); GAGS[id]!.draw(b.p, 40, 60, p, t);
          sameOps(a.ops, b.ops, `${id} p=${p} t=${t}`);
        }
      }
    });
  }

  it('pop.px.json reproduces POP_DECO and POP_EMOJI row by row', () => {
    const lib = vm.runInNewContext(`${popSrc}\n({ POP_DECO, POP_EMOJI })`, { ...engine }) as Record<string, Record<string, { pal: Record<string, string>; frames: string[][]; fps?: number }>>;
    const byName = new Map(allSprites.map((s) => [s.name, s]));
    for (const [prefix, group] of [['deco', lib.POP_DECO!], ['emoji', lib.POP_EMOJI!]] as const) {
      for (const [id, d] of Object.entries(group)) {
        const s = byName.get(`${prefix}.${id}`)!;
        expect(s, `${prefix}.${id}`).toBeDefined();
        expect(s.palette).toEqual(d.pal);
        expect(s.frames).toEqual(d.frames);
        expect(s.fps ?? 0).toBe(d.fps ?? 0);
      }
    }
  });

  it('fire, smoke, beam, poof, thermo and monitor are identical to the prototype', () => {
    const sec = (name: string, f: (g: unknown) => void, h: (p: Painter) => void) => {
      const a = protoRecorder(); f(a.g);
      const b = makePainter(); h(b.p); b.resetAlpha();
      sameOps(a.ops, b.ops, name);
    };
    for (const t of TS) for (const seed of [0, 3, 17]) {
      sec(`fire t=${t} seed=${seed}`, (g) => protoFx.drawFire!(g, 50, 70, 18, 11, t, seed), (p) => fire(p, 50, 70, 18, 11, t, seed));
      sec(`smoke t=${t}`, (g) => protoFx.drawSmoke!(g, 50, 70, t), (p) => smoke(p, 50, 70, t));
      for (const q of PS) {
        sec(`beam p=${q} t=${t}`, (g) => protoFx.drawBeam!(g, 50, 20, 75, q, t), (p) => beam(p, 50, 20, 75, q, t));
        sec(`poof p=${q}`, (g) => protoFx.drawPoof!(g, 50, 70, q), (p) => poof(p, 50, 70, q));
      }
      for (const lvl of [0, 30, 60, 100]) sec(`thermo ${lvl}`, (g) => protoFx.drawThermo!(g, 50, 20, lvl), (p) => thermo(p, 50, 20, lvl));
      for (const st of ['work', 'think', 'wait', 'fire', 'sleep', 'off'] as MonitorState[]) {
        sec(`monitor ${st} t=${t} seed=${seed}`, (g) => protoFx.drawMonitor!(g, 50, 20, st, t, seed), (p) => monitor(p, 50, 20, st, t, seed));
      }
    }
  });
});
