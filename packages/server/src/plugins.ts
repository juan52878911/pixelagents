import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mergeConfig, type Adapter, type InputFactory, type PaConfig, type PaEvent, type Reducer, type ServerPlugin } from '@pixelagents/protocol';
import { expandHome } from './util.js';

export interface LoadedPlugin {
  spec: string;
  plugin: ServerPlugin;
}

/** Imports a plugin by package name or by path (relative to cwd, absolute or ~/). */
export async function loadPlugin(spec: string): Promise<ServerPlugin> {
  const isPath = spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('~');
  const target = isPath ? pathToFileURL(path.resolve(expandHome(spec))).href : spec;
  const mod = (await import(/* @vite-ignore */ target)) as Record<string, unknown>;
  const cand = (mod.default ?? mod.plugin) as ServerPlugin | undefined;
  const plugin = cand && typeof cand === 'object' && 'default' in cand && (cand as unknown as { default?: ServerPlugin }).default ? (cand as unknown as { default: ServerPlugin }).default : cand;
  if (!plugin || typeof plugin !== 'object' || typeof plugin.name !== 'string') {
    throw new Error(`plugin "${spec}" has no default export with a name`);
  }
  return plugin;
}

export async function loadPlugins(specs: string[], extra: ServerPlugin[] = []): Promise<{ loaded: LoadedPlugin[]; warnings: string[] }> {
  const loaded: LoadedPlugin[] = [];
  const warnings: string[] = [];
  for (const spec of specs) {
    try {
      loaded.push({ spec, plugin: await loadPlugin(spec) });
    } catch (err) {
      warnings.push(`plugin ${spec} not loaded: ${(err as Error).message}`);
    }
  }
  for (const plugin of extra) loaded.push({ spec: `(inline) ${plugin.name}`, plugin });
  return { loaded, warnings };
}

export interface Registry {
  adapters: Map<string, Adapter>;
  reducers: Reducer[];
  inputs: Map<string, InputFactory>;
  ticks: { name: string; tick: NonNullable<ServerPlugin['tick']> }[];
  clients: Map<string, string>;
}

export function buildRegistry(plugins: ServerPlugin[], core: Adapter[]): Registry {
  const reg: Registry = { adapters: new Map(), reducers: [], inputs: new Map(), ticks: [], clients: new Map() };
  for (const a of core) reg.adapters.set(a.name, a);
  for (const p of plugins) {
    for (const a of p.adapters ?? []) reg.adapters.set(a.name, a);
    reg.reducers.push(...(p.reducers ?? []));
    for (const i of p.inputs ?? []) reg.inputs.set(i.type, i);
    if (p.tick) reg.ticks.push({ name: p.name, tick: p.tick });
    if (p.clientEntry) reg.clients.set(p.name, p.clientEntry);
  }
  return reg;
}

const CONCAT_KEYS = ['classify', 'effects', 'assets'] as const;

/** `over` wins over `base`; list-valued rule sets (classify, effects, assets) concatenate, deduplicated. */
export function layerConfig<T extends object>(base: T, over: unknown): T {
  const out = mergeConfig(base, over) as Record<string, unknown>;
  const b = base as Record<string, unknown>;
  const o = (over ?? {}) as Record<string, unknown>;
  for (const k of CONCAT_KEYS) {
    if (Array.isArray(b[k]) && Array.isArray(o[k])) {
      const seen = new Set<string>();
      out[k] = [...(b[k] as unknown[]), ...(o[k] as unknown[])].filter((x) => {
        const key = JSON.stringify(x);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }
  return out as T;
}

/** Plugin defaults go UNDER the user's config. */
export function effectiveConfig(user: PaConfig, plugins: ServerPlugin[]): PaConfig {
  let base: Record<string, unknown> = {};
  for (const p of plugins) if (p.defaults) base = layerConfig(base, p.defaults);
  return layerConfig(base, user) as unknown as PaConfig;
}

export const paAdapter: Adapter = {
  name: 'pa',
  parse(raw): PaEvent[] {
    const list = Array.isArray(raw) ? raw : [raw];
    const out: PaEvent[] = [];
    for (const r of list) {
      if (r && typeof r === 'object' && typeof (r as PaEvent).entity === 'string' && typeof (r as PaEvent).kind === 'string') {
        out.push(r as PaEvent);
      }
    }
    return out;
  },
};
