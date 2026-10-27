import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { applyRules, CONFIG_SCHEMA, DEFAULT_CONFIG, matches, mergeConfig, renderTemplate } from '../src/index.js';

describe('config schema', () => {
  it('accepts the default config', () => {
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(CONFIG_SCHEMA);
    expect(validate(DEFAULT_CONFIG), JSON.stringify(validate.errors)).toBe(true);
  });
  it('rejects unknown top-level keys', () => {
    const validate = new Ajv2020({ strict: false }).compile(CONFIG_SCHEMA);
    expect(validate({ ...DEFAULT_CONFIG, nope: 1 })).toBe(false);
  });
});

describe('rules', () => {
  const e = { kind: 'agent', labels: { account: 'work', host: 'vm-1' }, view: {} };
  it('matches globs, lists and regexes', () => {
    expect(matches(e, { 'labels.host': 'vm-*' })).toBe(true);
    expect(matches(e, { 'labels.account': ['personal', 'work'] })).toBe(true);
    expect(matches(e, { kind: '/^ag/' })).toBe(true);
    expect(matches(e, { 'labels.missing': '?*' })).toBe(false);
  });
  it('applies rules in order with templates', () => {
    const out = applyRules(e, [
      { match: { kind: 'agent' }, set: { 'view.group': '{{labels.host}}', 'view.skin': 'a' } },
      { match: { 'labels.account': 'work' }, set: { 'view.skin': '{{labels.account}}' } },
    ]);
    expect(out.view).toEqual({ group: 'vm-1', skin: 'work' });
    expect(e.view).toEqual({});
  });
  it('renders missing paths as empty', () => {
    expect(renderTemplate('{{labels.host}}/{{labels.x}}', e)).toBe('vm-1/');
  });
  it('merges config layers', () => {
    const c = mergeConfig(DEFAULT_CONFIG, { server: { port: 5000 }, plugins: [] });
    expect(c.server).toEqual({ host: '127.0.0.1', port: 5000 });
    expect(c.plugins).toEqual([]);
  });
});

describe('plugin input types', () => {
  it('accepts an input type registered by a plugin and still rejects broken built-ins', () => {
    const validate = new Ajv2020({ strict: false }).compile(CONFIG_SCHEMA);
    const ok = { ...DEFAULT_CONFIG, inputs: [{ id: 'load', type: 'host-local', adapter: 'host-stats', everySec: 15, options: { host: 'laptop' } }] };
    expect(validate(ok), JSON.stringify(validate.errors)).toBe(true);
    const bad = { ...DEFAULT_CONFIG, inputs: [{ id: 'f', type: 'file', adapter: 'x' }] };
    expect(validate(bad)).toBe(false);
  });
});
