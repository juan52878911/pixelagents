import type { Filter } from 'pixi.js';
import { makeFilter, setUniforms } from './host.js';
import { FILTER_SPECS, resolveParams, type FilterSpec } from './specs.js';

export { FILTER_SPECS, PALETTES, daylight, resolveParams } from './specs.js';

// Structurally the host's `FilterFactory` / `ClientPlugin` (packages/web/src/plugin-api.ts); declared here so the
// node-side typecheck does not pull in the browser types.
type FilterFactory = (params: Record<string, unknown>) => Filter | null;
interface ClientPlugin { name: string; filters: Record<string, FilterFactory> }

function factoryFor(spec: FilterSpec): FilterFactory {
  return (raw) => {
    const p = resolveParams(spec.params, raw);
    const filter = makeFilter(spec.fragment(p), spec.uniforms(p), spec.name);
    // daynight follows the wall clock when no hour is forced.
    if (spec.name === 'daynight' && (p.hour as number) < 0) {
      const timer = setInterval(() => setUniforms(filter, spec.uniforms(p)), 60_000);
      (timer as { unref?: () => void }).unref?.();
      const destroy = filter.destroy.bind(filter) as Filter['destroy'];
      filter.destroy = (...a: Parameters<Filter['destroy']>) => { clearInterval(timer); destroy(...a); };
    }
    return filter;
  };
}

export const filters: Record<string, FilterFactory> = Object.fromEntries(
  Object.values(FILTER_SPECS).map((s) => [s.name, factoryFor(s)]),
);

// `defineClientPlugin` is the identity; not imported so the bundle has no runtime dependency on the host.
const plugin: ClientPlugin = { name: 'effects', filters };
export default plugin;
