import type { PaConfig } from '@pixelagents/protocol';
import type { Store } from '../../store.js';
import type { Api, AssetInfo, PluginInfo } from './api.js';
import type { Catalog } from './catalog.js';
import type { FormError, Schema } from './form.js';

/** What every section of the panel shares. */
export interface SettingsState {
  api: Api;
  store: Store;
  schema: Schema;
  plugins: PluginInfo[];
  assets: AssetInfo[];
  catalog: Catalog;
  /** What the server had when we last loaded or saved. */
  baseline: PaConfig;
  /** What the user is editing. */
  draft: PaConfig;
  errors: FormError[];
  /** Replace one top-level section of the draft. */
  update<K extends keyof PaConfig>(key: K, value: PaConfig[K]): void;
  /** Replace the whole draft (advanced editor). */
  replace(cfg: PaConfig): void;
  /** Called after every draft change; returns an unsubscribe. */
  onDraft(cb: () => void): () => void;
  /** Re-fetch assets and the catalog (after an upload or an SSE `assets` event). */
  refreshAssets(): Promise<void>;
  toast(msg: string, kind?: 'ok' | 'error'): void;
  /** Re-render the visible section from the current draft. */
  rerender(): void;
}

export interface SectionView {
  el: HTMLElement;
  setErrors?(errors: FormError[]): void;
  dispose?(): void;
}
export type SectionBuilder = (st: SettingsState) => SectionView;
