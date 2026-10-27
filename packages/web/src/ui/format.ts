import type { Entity, PaEvent } from '@pixelagents/protocol';

/** 5s, 3m 12s, 2h 05m, 1d 3h. Negative or invalid values read as 0s. */
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** "ahora", "hace 12s", "hace 3 min", "hace 2 h", "hace 4 d". */
export function fmtAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 3) return 'ahora';
  if (s < 60) return `hace ${s}s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/** $0.00 for zero, 4 decimals under a cent, 2 up to 100, none above. */
export function fmtCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd) || usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString('en-US')}`;
}

export function fmtPct(v: number | undefined): string {
  return v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v)}%`;
}

/** Shortens a path relative to the repo ("/home/u/code/web-app/src/app.ts" → "src/app.ts"), else keeps the tail. */
export function shortPath(detail: string, repo?: string, maxLen = 48): string {
  let p = detail;
  if (repo) {
    const i = p.indexOf(`/${repo}/`);
    if (i >= 0) p = p.slice(i + repo.length + 2);
  }
  p = p.replace(/^\/(?:Users|home)\/[^/]+\//, '~/');
  if (p.length <= maxLen) return p;
  return `…${p.slice(p.length - (maxLen - 1))}`;
}

/** Display name of an entity: session label or the id tail. */
export function entityName(e: Entity): string {
  return e.labels.name ?? e.labels.session ?? e.id.replace(/^[^:]*:/, '');
}

/** "laptop/web-app · Edit src/app.ts" */
export function feedLine(ev: PaEvent, e: Entity | undefined): string {
  const l = e?.labels ?? ev.labels ?? {};
  const where = [l.host, l.repo].filter(Boolean).join('/') || ev.entity;
  const tool = typeof ev.attrs?.tool === 'string' ? ev.attrs.tool : undefined;
  const detail = typeof ev.attrs?.detail === 'string' ? shortPath(ev.attrs.detail, l.repo, 40) : '';
  const what = tool ? `${tool}${detail ? ' ' + detail : ''}` : ev.kind;
  return `${where} · ${what}`;
}
