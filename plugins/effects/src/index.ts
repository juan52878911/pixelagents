import { fileURLToPath } from 'node:url';
import { definePlugin } from '@pixelagents/protocol';

/** Built by `npm run build -w @pixelagents/plugin-effects` (esbuild, ESM, no imports). */
const clientEntry = fileURLToPath(new URL('../dist/client.js', import.meta.url));

/**
 * Shader filters for the world layers: crt, daynight, glow, scanlines, palette, outline.
 * Enable them from `config.effects`, e.g. `{ "layer": "world", "filter": "daynight", "params": { "hour": 22 } }`.
 * The filters themselves live in the browser bundle (src/client).
 */
export default definePlugin({ name: 'effects', clientEntry });
