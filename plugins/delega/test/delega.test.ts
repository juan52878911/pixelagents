import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { delegaQuotaAdapter, delegaSpendAdapter } from '../src/index.js';

const fx = (n: string) => readFileSync(new URL('../../../fixtures/' + n, import.meta.url), 'utf8');
const ctx = { input: 'd', options: {}, now: () => new Date('2026-01-15T10:00:00Z') };

describe('delega-quota', () => {
  it('fixture: personal account and total slots', () => {
    const evs = delegaQuotaAdapter.parse(fx('delega.quota.txt'), ctx);
    expect(evs.map((e) => e.entity)).toEqual(['account:personal', 'account:total']);
    expect(evs[0]!.attrs).toEqual({ five_hour_pct: 27, weekly_pct: 7, slots_free: 2, spend_usd: 6.49, budget_usd: 150 });
    expect(evs[0]!.labels).toEqual({ account: 'personal' });
    expect(evs[1]!.attrs).toEqual({ slots_free: 2 });
  });

  it('tolerant: unknown lines and a broken block are ignored', () => {
    const txt = ['ruido', '[work] 5 h: 80 % · semanal: 61 %', 'línea rara ???', '[broken] sin datos', 'CUPO: x · puedes lanzar 1 más', '', '¿?'].join('\n');
    const evs = delegaQuotaAdapter.parse(txt, ctx);
    expect(evs.map((e) => e.entity)).toEqual(['account:work', 'account:broken', 'account:total']);
    expect(evs[0]!.attrs).toEqual({ five_hour_pct: 80, weekly_pct: 61 });
    expect(evs[1]!.attrs).toEqual({ slots_free: 1 });
  });

  it('garbage and non-strings yield nothing', () => {
    expect(delegaQuotaAdapter.parse('nada que ver', ctx)).toEqual([]);
    expect(delegaQuotaAdapter.parse({ a: 1 }, ctx)).toEqual([]);
    expect(delegaQuotaAdapter.parse('', ctx)).toEqual([]);
  });
});

describe('delega-spend', () => {
  it('fixture: total and one per profile', () => {
    const evs = delegaSpendAdapter.parse(fx('delega.spend.txt'), ctx);
    expect(evs.map((e) => [e.entity, e.attrs])).toEqual([
      ['account:total', { spend_usd: 12.8 }],
      ['account:work', { spend_usd: 30.4, budget_usd: 150 }],
      ['account:personal', { spend_usd: 6.49, budget_usd: 150 }],
    ]);
  });

  it('tolerant of decimal commas and junk', () => {
    const evs = delegaSpendAdapter.parse('basura\npresupuesto de hoy · x: 3,50 $ de 10,00 $\npresupuesto de hoy · y: ?? $\n', ctx);
    expect(evs.map((e) => [e.entity, e.attrs])).toEqual([['account:x', { spend_usd: 3.5, budget_usd: 10 }]]);
  });
});
