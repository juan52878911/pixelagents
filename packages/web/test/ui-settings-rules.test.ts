import { describe, expect, it } from 'vitest';
import type { Entity, Rule } from '@pixelagents/protocol';
import { entityPaths, formatMatchValue, parseMatchValue, parseSetValue, previewRules } from '../src/ui/settings/rules.js';

const ent = (id: string, labels: Record<string, string>, group = 'old'): Entity => ({
  id, kind: 'agent', labels, status: 'working', metrics: { cost_usd: 1 }, firstSeen: '', lastSeen: '', history: [], view: { group },
});

const ents = [
  ent('agent:1', { host: 'mac', account: 'work', repo: 'api' }),
  ent('agent:2', { host: 'mac', account: 'personal', repo: 'web' }),
  ent('agent:3', { host: 'vm', account: 'work', repo: 'api' }),
];

describe('rules preview', () => {
  it('groups by the draft template and reports who would move', () => {
    const p = previewRules(ents, [], { by: '{{labels.account}}', label: 'Acct {{labels.account}}', kinds: { work: 'lab', '*': 'office' } });
    expect(p.groups.map((g) => g.id)).toEqual(['personal', 'work']);
    expect(p.groups.find((g) => g.id === 'work')).toMatchObject({ kind: 'lab', label: 'Acct work', entities: ['agent:1', 'agent:3'] });
    expect(p.moved).toHaveLength(3);
    expect(p.total).toBe(3);
  });

  it('applies rules to skins and lets a rule set view.group over the template', () => {
    const rules: Rule[] = [
      { match: { 'labels.account': 'work' }, set: { 'view.skin': 'office-{{labels.account}}' } },
      { match: { 'labels.repo': 'web' }, set: { 'view.group': 'frontend' } },
    ];
    const p = previewRules(ents, rules, { by: '{{labels.host}}' });
    expect(p.skins['office-work']).toEqual(['agent:1', 'agent:3']);
    expect(p.skins['(none)']).toEqual(['agent:2']);
    expect(p.groups.map((g) => g.id)).toEqual(['frontend', 'mac', 'vm']);
  });

  it('does not touch the entities it receives', () => {
    const before = JSON.stringify(ents);
    previewRules(ents, [{ match: { kind: 'agent' }, set: { 'view.skin': 'x' } }], { by: '{{labels.host}}' });
    expect(JSON.stringify(ents)).toBe(before);
  });

  it('falls back to "default" when the template renders empty', () => {
    const p = previewRules(ents, [], { by: '{{labels.team}}' });
    expect(p.groups.map((g) => g.id)).toEqual(['default']);
  });

  it('suggests paths from the entities and parses editor text', () => {
    expect(entityPaths(ents)).toEqual(expect.arrayContaining(['labels.account', 'labels.repo', 'metrics.cost_usd', 'kind', 'view.group']));
    expect(parseMatchValue('a, b')).toEqual(['a', 'b']);
    expect(parseMatchValue('kindling-*')).toBe('kindling-*');
    expect(formatMatchValue(['a', 'b'])).toBe('a, b');
    expect(parseSetValue('true')).toBe(true);
    expect(parseSetValue('12')).toBe(12);
    expect(parseSetValue('{{labels.x}}')).toBe('{{labels.x}}');
  });
});
