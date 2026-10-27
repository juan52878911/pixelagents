/**
 * Client plugin API. A plugin's `/plugins/<name>/client.js` default-exports `defineClientPlugin({...})`.
 * Everything is optional; the host registers what is present when `loadClientPlugins` runs.
 */
import type { BehaviorDef } from './engine/behaviors.js';
import type { FilterFactory } from './engine/filters.js';

export interface PanelContext {
  /** Latest state; subscribe on the store for changes. */
  store: import('./store.js').Store;
}
export interface PanelDef {
  id: string;
  title: string;
  /** Mounts the panel into `el`; return a cleanup function. */
  mount(el: HTMLElement, ctx: PanelContext): void | (() => void);
}

export interface ClientPlugin {
  name: string;
  /** Behavior name → definition (referenced from `config.behaviors`). */
  behaviors?: Record<string, BehaviorDef>;
  /** Filter name → factory (referenced from `config.effects`). */
  filters?: Record<string, FilterFactory>;
  /** Growth strategies for the world generator. Opaque to the engine; the world defines the shape. */
  strategies?: Record<string, unknown>;
  /** Paths/URLs of `.px.json` files to load into the sprite library. */
  sprites?: string[];
  panels?: PanelDef[];
}

export function defineClientPlugin<T extends ClientPlugin>(p: T): T {
  return p;
}

const strategies = new Map<string, unknown>();
const panels = new Map<string, PanelDef>();
const spriteUrls = new Set<string>();

export function registerStrategy(name: string, def: unknown): void { strategies.set(name, def); }
export function getStrategies(): ReadonlyMap<string, unknown> { return strategies; }
export function getPanels(): PanelDef[] { return [...panels.values()]; }
export function getPluginSprites(): string[] { return [...spriteUrls]; }

export interface PluginHost {
  registerBehavior(name: string, def: BehaviorDef): void;
  registerFilter(name: string, factory: FilterFactory): void;
  /** How to import a module; defaults to a dynamic `import()` (override in tests). */
  importModule?(url: string): Promise<unknown>;
  onError?(name: string, err: unknown): void;
}

/** Registers one plugin's contributions. */
export function registerClientPlugin(p: ClientPlugin, host: Pick<PluginHost, 'registerBehavior' | 'registerFilter'>): void {
  for (const [k, v] of Object.entries(p.behaviors ?? {})) host.registerBehavior(k, v);
  for (const [k, v] of Object.entries(p.filters ?? {})) host.registerFilter(k, v);
  for (const [k, v] of Object.entries(p.strategies ?? {})) strategies.set(k, v);
  for (const u of p.sprites ?? []) spriteUrls.add(u);
  for (const pn of p.panels ?? []) panels.set(pn.id, pn);
}

/** Imports `/plugins/<name>/client.js` for each name. A failing plugin is reported and skipped. */
export async function loadClientPlugins(names: string[], host?: PluginHost): Promise<ClientPlugin[]> {
  const h: PluginHost = host ?? await defaultHost();
  const imp = h.importModule ?? ((u: string) => import(/* @vite-ignore */ u));
  const loaded: ClientPlugin[] = [];
  await Promise.all(names.map(async (name) => {
    try {
      const mod = (await imp(`/plugins/${name}/client.js`)) as { default?: ClientPlugin };
      const p = mod.default;
      if (!p || typeof p !== 'object') throw new Error('no default export');
      registerClientPlugin(p, h);
      loaded.push(p);
    } catch (err) {
      (h.onError ?? ((n, e) => console.warn(`plugin "${n}" failed to load`, e)))(name, err);
    }
  }));
  return loaded;
}

async function defaultHost(): Promise<PluginHost> {
  const [b, f] = await Promise.all([import('./engine/behaviors.js'), import('./engine/filters.js')]);
  return { registerBehavior: b.registerBehavior, registerFilter: f.registerFilter };
}
