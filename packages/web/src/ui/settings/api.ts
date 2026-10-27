import type { PaConfig } from '@pixelagents/protocol';
import type { FormError, Schema } from './form.js';

export interface PluginInfo { name: string; adapters: string[]; reducers: string[]; inputs: string[]; client?: string }
export interface AssetInfo { name: string; size: number; kind: 'sprites' | 'png'; source: 'upload' | 'dir' }
export type SaveResult =
  | { ok: true; restartRequired: string[]; warnings: string[] }
  | { ok: false; status: number; errors: FormError[] };

/** Thin client of the server's settings endpoints. `base` is '' when the page is served by (or proxied to) the server. */
export class Api {
  constructor(readonly base = '', public token: string | null = null) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return this.token ? { authorization: `Bearer ${this.token}`, ...extra } : extra;
  }

  private async json<T>(path: string): Promise<T> {
    const r = await fetch(this.base + path, { headers: this.headers(), cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  getConfig(): Promise<PaConfig> { return this.json('/api/config'); }
  getSchema(): Promise<Schema> { return this.json('/api/schema'); }
  getPlugins(): Promise<PluginInfo[]> { return this.json('/api/plugins'); }
  getAssets(): Promise<AssetInfo[]> { return this.json('/api/assets'); }
  getAsset<T = unknown>(name: string): Promise<T> { return this.json(`/api/assets/${encodeURIComponent(name)}`); }
  assetUrl(name: string): string { return `${this.base}/api/assets/${encodeURIComponent(name)}`; }

  async putConfig(cfg: unknown): Promise<SaveResult> {
    let r: Response;
    try {
      r = await fetch(this.base + '/api/config', { method: 'PUT', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify(cfg) });
    } catch (e) {
      return { ok: false, status: 0, errors: [{ path: '/', message: `Cannot reach the server: ${(e as Error).message}` }] };
    }
    const body = (await r.json().catch(() => ({}))) as { errors?: FormError[]; error?: string; restartRequired?: string[]; warnings?: string[] };
    if (r.ok) return { ok: true, restartRequired: body.restartRequired ?? [], warnings: body.warnings ?? [] };
    return { ok: false, status: r.status, errors: body.errors ?? [{ path: '/', message: body.error ?? `HTTP ${r.status}` }] };
  }

  async putAsset(name: string, body: Blob | string, type: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const r = await fetch(`${this.base}/api/assets/${encodeURIComponent(name)}`, { method: 'PUT', headers: this.headers({ 'content-type': type }), body });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? `HTTP ${r.status}` };
  }
}
