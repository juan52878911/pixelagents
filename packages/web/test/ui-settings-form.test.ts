// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { CONFIG_SCHEMA, DEFAULT_CONFIG } from '@pixelagents/protocol';
import { buildForm, defaultFor } from '../src/ui/settings/form.js';

const fire = (el: Element, type = 'change') => el.dispatchEvent(new Event(type, { bubbles: true }));

describe('schema form generator', () => {
  it('round-trips the default config without losses, even when every control fires change', () => {
    const seen: unknown[] = [];
    const f = buildForm(CONFIG_SCHEMA, DEFAULT_CONFIG, (v) => seen.push(v));
    expect(f.value()).toEqual(DEFAULT_CONFIG);
    for (const c of f.el.querySelectorAll('input,select,textarea')) fire(c);
    expect(f.value()).toEqual(DEFAULT_CONFIG);
    expect(seen).toHaveLength(0); // untouched controls never commit
  });

  it('round-trips a richer config (inputs of every type, gags list, effects with params)', () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.inputs = [
      { id: 'a', type: 'file', path: '/x', adapter: 'claude-code', fromStart: true, options: { k: [1, 2] } },
      { id: 'b', type: 'command', command: 'tail', args: ['-f', 'x'], adapter: 'nod', restartSec: 3 },
      { id: 'c', type: 'poll', url: 'http://x', everySec: 2.5, adapter: 'nod', enabled: false },
      { id: 'd', type: 'hub', url: 'http://h', token: 't' },
    ];
    cfg.fun.gags = ['coffee', 'cat'];
    cfg.effects = [{ layer: 'screen', filter: 'crt', enabled: true, params: { amount: 0.5 } }];
    cfg.pluginConfig = { pop: { a: { deep: true } } };
    const f = buildForm(CONFIG_SCHEMA, cfg, () => {});
    for (const c of f.el.querySelectorAll('input,select,textarea')) fire(c);
    expect(f.value()).toEqual(cfg);
  });

  it('edits land on the right path and the result stays valid against the schema', () => {
    let last: any = null;
    const f = buildForm(CONFIG_SCHEMA, DEFAULT_CONFIG, (v) => { last = v; });
    const fps = f.el.querySelector<HTMLInputElement>('[data-path="/world/fps"] input')!;
    fps.value = '30'; fire(fps);
    expect(last.world.fps).toBe(30);
    expect(DEFAULT_CONFIG.world.fps).toBe(60); // the input object is not mutated
    const by = f.el.querySelector<HTMLInputElement>('[data-path="/groups/by"] input')!;
    by.value = '{{labels.account}}'; fire(by);
    expect(last.groups.by).toBe('{{labels.account}}');
    const emojis = f.el.querySelector<HTMLInputElement>('[data-path="/fun/emojis"] input')!;
    emojis.checked = false; fire(emojis);
    expect(last.fun.emojis).toBe(false);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    expect(ajv.validate(CONFIG_SCHEMA, last)).toBe(true);
  });

  it('adds a source switching its type, and removes it', () => {
    let last: any = DEFAULT_CONFIG;
    const f = buildForm(CONFIG_SCHEMA, DEFAULT_CONFIG, (v) => { last = v; });
    const add = [...f.el.querySelectorAll<HTMLButtonElement>('[data-path="/inputs"] > button')][0]!;
    add.click();
    expect(last.inputs).toHaveLength(3);
    const sel = f.el.querySelectorAll<HTMLSelectElement>('[data-path="/inputs/2"] select')[0]!;
    sel.value = '3'; fire(sel); // poll
    expect(last.inputs[2].type).toBe('poll');
    expect(last.inputs[2].everySec).toBeGreaterThanOrEqual(1);
    f.el.querySelector<HTMLButtonElement>('[aria-label="Remove inputs #3"]')!.click();
    expect(last.inputs).toHaveLength(2);
  });

  it('shows server errors under the field they refer to', () => {
    const f = buildForm(CONFIG_SCHEMA, DEFAULT_CONFIG, () => {});
    f.setErrors([{ path: '/world/fps', message: 'must be >= 10' }, { path: '/inputs/0/path', message: 'bad' }]);
    expect(f.el.querySelector('[data-path="/world/fps"] .pa-err')!.textContent).toContain('must be >= 10');
    expect(f.el.querySelector('[data-path="/world/fps"] input')!.getAttribute('aria-invalid')).toBe('true');
    expect(f.el.querySelector('[data-path="/inputs/0/path"] .pa-err')!.textContent).toBe('bad');
  });

  it('defaultFor builds valid values for required fields', () => {
    const ajv = new Ajv2020({ strict: false });
    const v = defaultFor((CONFIG_SCHEMA as any).properties.world) as Record<string, unknown>;
    expect(Object.keys(v)).toEqual(expect.arrayContaining(['generator', 'seed', 'width']));
    expect(ajv.validate({ type: 'object' }, v)).toBe(true);
  });
});
