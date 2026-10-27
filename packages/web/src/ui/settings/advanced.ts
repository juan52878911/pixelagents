import type { PaConfig } from '@pixelagents/protocol';
import Ajv2020 from 'ajv/dist/2020.js';
import { h, uid } from './dom.js';
import type { FormError } from './form.js';
import type { SectionView, SettingsState } from './state.js';

export function validateAgainst(schema: unknown, value: unknown): FormError[] {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const ok = ajv.validate(schema as object, value);
  return ok ? [] : (ajv.errors ?? []).map((e) => ({ path: e.instancePath || '/', message: e.message ?? 'invalid' }));
}

/** Advanced: the whole config as JSON, validated against the server schema as you type. */
export function advancedSection(st: SettingsState): SectionView {
  const id = uid('f');
  const ta = h('textarea', { id, class: 'pa-json pa-big', rows: 28, spellcheck: 'false' });
  ta.value = JSON.stringify(st.draft, null, 2);
  const out = h('ul', { class: 'pa-errlist', 'aria-live': 'polite' });
  const status = h('p', { class: 'pa-help', role: 'status' });

  const show = (errs: FormError[], note = ''): void => {
    out.replaceChildren(...errs.map((e) => h('li', null, h('code', null, e.path), ` ${e.message}`)));
    status.textContent = errs.length ? `${errs.length} problem${errs.length === 1 ? '' : 's'}${note}` : `Valid${note}`;
    ta.setAttribute('aria-invalid', String(errs.length > 0));
  };
  const check = (): void => {
    try {
      const v = JSON.parse(ta.value) as PaConfig;
      show(validateAgainst(st.schema, v));
    } catch (e) {
      show([{ path: '(syntax)', message: (e as Error).message }]);
    }
  };
  ta.addEventListener('input', check);
  ta.addEventListener('change', () => {
    try { st.replace(JSON.parse(ta.value) as PaConfig); } catch { /* shown by check() */ }
  });
  check();
  const el = h('div', { class: 'pa-stack' },
    h('p', { class: 'pa-help' }, 'The complete configuration. Valid edits become part of the draft immediately; use Save to apply them.'),
    h('label', { for: id }, 'Configuration (JSON)'), ta, status, out);
  return { el, setErrors: (errs) => { if (errs.length) show(errs, ' (from the server)'); } };
}
