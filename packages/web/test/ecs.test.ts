import { describe, expect, it } from 'vitest';
import { World, animatorSystem, spriteSyncSystem, type SpriteNode } from '../src/engine/ecs.js';
import { BufferPainter, FONT } from '../src/engine/painter.js';
import { behaviorSystem, registerBehavior, setBehavior, getBehavior } from '../src/engine/behaviors.js';
import { FrameStats } from '../src/perf-hud.js';

const sheet = (anchor: [number, number] = [5, 14]) => ({
  name: 's', w: 10, h: 14, anchor, fps: 10, tags: { walk: [1, 2] as [number, number] }, meta: {},
  frames: [{ id: 0 }, { id: 1 }, { id: 2 }] as never[],
});
const node = (): SpriteNode => ({ x: 0, y: 0, visible: true, zIndex: 0, texture: null, scale: { x: 1, y: 1, set() {} } });

describe('World', () => {
  it('creates, looks up by key, and swap-removes keeping indices consistent', () => {
    const w = new World();
    const a = w.create('a'), b = w.create('b'), c = w.create('c');
    expect(w.size).toBe(3);
    w.destroy(a);
    expect(w.size).toBe(2);
    expect(w.get('a')).toBeUndefined();
    expect(w.entities.every((e, i) => e.index === i)).toBe(true);
    expect(w.get('c')).toBe(c);
    w.destroy(b); w.destroy(c);
    expect(w.size).toBe(0);
  });
  it('recycles entities with clean state and new ids', () => {
    const w = new World();
    const a = w.create('a');
    a.transform.x = 9; a.label = { text: 'x', color: 0 };
    const id = a.id;
    w.destroy(a);
    const b = w.create('b');
    expect(b).toBe(a);
    expect(b.id).not.toBe(id);
    expect(b.transform.x).toBe(0);
    expect(b.label).toBeNull();
    w.destroy(b); w.destroy(b); // double destroy is a no-op
    expect(w.size).toBe(0);
  });
  it('runs systems in order with dt and advances the clock', () => {
    const w = new World();
    const log: string[] = [];
    w.addSystem({ name: 'a', update: (dt) => log.push(`a${dt}`) }).addSystem({ name: 'b', update: () => log.push('b') });
    w.update(0.5);
    expect(log).toEqual(['a0.5', 'b']);
    expect(w.time).toBe(500);
    w.removeSystem('a'); w.update(0.1);
    expect(log.at(-1)).toBe('b');
  });
});

describe('animator + sprite sync', () => {
  it('picks frames inside the tag and snaps position to whole pixels', () => {
    const w = new World().addSystem(animatorSystem).addSystem(spriteSyncSystem);
    const e = w.create('x');
    const n = node();
    e.sprite = { sheet: sheet(), node: n, frame: 0, layer: 'actors' };
    e.animator = { time: 0, tag: 'walk', playing: true, speed: 1 };
    e.transform.x = 20.6; e.transform.y = 30.2;
    w.update(0.01);
    expect(e.sprite.frame).toBe(1);
    expect((n.texture as { id: number }).id).toBe(1);
    expect(n.x).toBe(21 - 5); expect(n.y).toBe(30 - 14);
    w.update(0.1); // 110 ms at 10 fps → second frame of the tag
    expect(e.sprite.frame).toBe(2);
    e.transform.flip = true; w.update(0);
    expect(n.scale.x).toBe(-1);
    expect(n.x).toBe(21 + 1 + 5);
  });
});

describe('behaviors', () => {
  it('runs enter once, update every frame, exit on switch', () => {
    const log: string[] = [];
    registerBehavior('t-a', { enter: () => log.push('enter-a'), update: () => log.push('upd-a'), exit: () => log.push('exit-a') });
    registerBehavior('t-b', { enter: () => log.push('enter-b'), update: () => log.push('upd-b') });
    const w = new World().addSystem(behaviorSystem(100, 100));
    const e = w.create('x');
    const ctx = { world: w, width: 100, height: 100, dt: 0 };
    expect(setBehavior(e, 'nope', ctx)).toBe(false);
    expect(getBehavior('t-a')).toBeDefined();
    setBehavior(e, 't-a', ctx);
    w.update(0.016); w.update(0.016);
    setBehavior(e, 't-b', ctx);
    w.update(0.016);
    expect(log).toEqual(['enter-a', 'upd-a', 'upd-a', 'exit-a', 'enter-b', 'upd-b']);
  });
  it('wander moves an actor towards targets inside the world', () => {
    const w = new World().addSystem(behaviorSystem(200, 100));
    const e = w.create('x');
    e.transform.x = 50; e.transform.y = 50;
    setBehavior(e, 'wander', { world: w, width: 200, height: 100, dt: 0 });
    for (let i = 0; i < 600; i++) w.update(1 / 60);
    expect(e.transform.x).toBeGreaterThanOrEqual(0); expect(e.transform.x).toBeLessThanOrEqual(200);
    expect(e.transform.y).toBeLessThanOrEqual(100);
    expect(e.transform.x !== 50 || e.transform.y !== 50).toBe(true);
  });
});

describe('BufferPainter', () => {
  it('draws pixels, rects, sprites (flip) and clips to bounds', () => {
    const p = new BufferPainter(8, 4);
    p.px(1, 1, '#ff0000'); p.px(-1, 0, '#ff0000'); p.px(99, 0, '#ff0000');
    p.rect(2, 2, 3, 5, '#00ff00');
    p.sprite(['AB.'], 0, 0, { A: '#0000ff', B: '#ffffff' }, true);
    const at = (x: number, y: number) => [...p.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
    expect(at(1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(4, 3)).toEqual([0, 255, 0, 255]);
    expect(at(5, 2)).toEqual([0, 0, 0, 0]);
    // flipped: width 3 → A at x=2, B at x=1
    expect(at(2, 0)).toEqual([0, 0, 255, 255]);
    expect(at(1, 0)).toEqual([255, 255, 255, 255]);
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
  });
  it('blends with global alpha and restores it', () => {
    const p = new BufferPainter(2, 1);
    p.px(0, 0, '#000000');
    const prev = p.alpha(0.5);
    expect(prev).toBe(1);
    p.px(0, 0, '#ffffff');
    expect(p.data[0]).toBe(128);
    p.alpha(prev);
    p.px(1, 0, '#123456');
    expect(p.data[7]).toBe(255);
  });
  it('renders the 3x5 font at scale and tracks dirty', () => {
    const p = new BufferPainter(16, 16);
    expect(p.dirty).toBe(false);
    p.text('I', 0, 0, '#ffffff', 2); // I = 111/010/010/010/111
    expect(p.dirty).toBe(true);
    const at = (x: number, y: number) => p.data[(y * 16 + x) * 4 + 3];
    expect(at(0, 0)).toBe(255); expect(at(5, 1)).toBe(255); // top bar, scaled ×2
    expect(at(0, 2)).toBe(0); expect(at(2, 2)).toBe(255); // stem only in the middle column
    expect(Object.keys(FONT).length).toBeGreaterThan(40);
    for (const g of Object.values(FONT)) expect(g).toHaveLength(15);
  });
});

describe('FrameStats', () => {
  it('computes mean and p95 over a rolling window', () => {
    const s = new FrameStats(100);
    for (let i = 1; i <= 100; i++) s.push(i, 16);
    expect(s.cpuMean).toBeCloseTo(50.5);
    expect(s.cpuP95).toBe(95);
    expect(s.fps).toBeCloseTo(62.5);
    for (let i = 0; i < 100; i++) s.push(1, 16);
    expect(s.cpuP95).toBe(1);
  });
});
