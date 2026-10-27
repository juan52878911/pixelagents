# Writing plugins

Everything in pixelagents is an extension point. Read the flow once:

```
source -> input (http|file|command|poll|hub|yours) -> adapter -> PaEvent
PaEvent -> reducers (core, then plugins) -> Entity -> classify rules -> entity.view + groups
state -> SSE -> web: world, actors (behaviors), filters (effects), sprites and skins
```

Pick the lightest tool that does the job:

| You want to... | Use | Code? |
|---|---|---|
| show a JSON source already available over HTTP/file/command | the `map` adapter | no |
| parse a custom format, or fold events into entity state | `definePlugin` with an adapter and a reducer | server |
| receive data in a way the built-in inputs cannot | an `InputFactory` | server |
| change how entities look or group | `classify` rules, `skins`, `behaviors` | no |
| change how an actor moves | `registerBehavior` through a client plugin | browser |
| post-process the picture | a filter (GLSL) through a client plugin | browser |
| change how offices grow | a growth strategy in a client plugin | browser |
| add art | `.px.json` sprites and skins | no |

All code examples below are real files under `examples/snippets/` (and `examples/hello-plugin/`),
pasted by `node scripts/embed-snippets.mjs` and exercised by `npx vitest run --config examples/vitest.config.ts`.
Config reference: [config.md](config.md).

## Plugin anatomy

A plugin is an ESM module (npm package or a path) listed in `config.plugins`. The server half default-exports
`definePlugin({ name, adapters?, reducers?, inputs?, defaults?, clientEntry?, tick? })`. `clientEntry` is the
absolute path of a built browser bundle; the server serves it at `/plugins/<name>/client.js` and the web app
imports it, expecting a default export shaped like `ClientPlugin`:
`{ name, behaviors?, filters?, strategies?, sprites?, panels? }`.

Build the browser half with esbuild to one ESM file with no runtime imports (see
`plugins/effects/scripts/build.mjs`): `"build": "node scripts/build.mjs"` in the plugin's package.json, so
`npm run build` produces `dist/client.js`. `defaults` (rules, skins, behaviors, effects) are merged under the
user's config; `classify`, `effects` and `assets` lists concatenate.

`examples/hello-plugin` is the smallest complete plugin: a `poll` source (`bin/sample.mjs`), an adapter, a
reducer, a rule, a filter, a client build and a test that also runs it against the real server. Its config:

<!-- snippet: examples/hello-plugin/config.example.json -->
```json
{
  "plugins": ["./examples/hello-plugin/src/index.ts", "@pixelagents/plugin-effects"],
  "inputs": [
    { "id": "hello", "type": "poll", "command": "node", "args": ["examples/hello-plugin/bin/sample.mjs"], "everySec": 5, "adapter": "hello" }
  ],
  "effects": [{ "layer": "world", "filter": "hello-sepia", "params": { "amount": 0.7 } }]
}
```
<!-- /snippet -->

## A new source without code: the `map` plugin

If the source is JSON (HTTP body, a file of lines, the output of a command), the `map` adapter turns each
record into an event from templates. `entity` and `kind` are required; `labels`, `attrs`, `ts` and `when`
are optional. A template that is exactly one `{{path}}` keeps its type (numbers stay numbers); `when` filters
records with the same glob matching as classification rules.

<!-- snippet: examples/snippets/map-source.config.json -->
```json
{
  "plugins": ["@pixelagents/plugin-map"],
  "inputs": [
    {
      "id": "ci",
      "type": "poll",
      "url": "http://127.0.0.1:9000/jobs/latest",
      "everySec": 10,
      "adapter": "map",
      "options": {
        "entity": "job:{{job.id}}",
        "kind": { "fromField": "status", "map": { "start": "session.start", "done": "turn.end", "*": "heartbeat" } },
        "labels": { "name": "{{job.name}} #{{job.id}}", "host": "ci" },
        "attrs": { "duration_s": "{{elapsed}}" },
        "ts": "{{at}}",
        "when": { "job.name": "build*" }
      }
    }
  ]
}
```
<!-- /snippet -->

Use the core kinds (`session.start`, `turn.end`, `tool.pre`, `state`, `metric`, `heartbeat`, ...) so the
core reducers drive status and activity for you.

## A new source with code: adapter and reducer

An adapter turns one raw record (parsed JSON, or the raw string for plain text) into `PaEvent`s. Pick fields
explicitly; never copy a record wholesale (privacy: no prompts, outputs or file contents in events). A reducer
folds events into the entity; `kinds` filters by prefix. Return the entity, or `null` to delete it.

<!-- snippet: examples/snippets/queue-plugin.ts -->
```ts
import { definePlugin, type Adapter, type PaEvent, type Reducer } from '@pixelagents/protocol';

/** Input: the plain text output of a command, e.g. `queue=emails depth=120 workers=3` per line. */
export const queueAdapter: Adapter = {
  name: 'queue',
  parse(raw, ctx) {
    const text = typeof raw === 'string' ? raw : '';
    const out: PaEvent[] = [];
    for (const line of text.split('\n')) {
      const kv = Object.fromEntries([...line.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1]!, m[2]!]));
      if (!kv.queue) continue;
      const depth = Number(kv.depth);
      if (!Number.isFinite(depth)) continue;
      out.push({
        ts: ctx.now().toISOString(),
        source: ctx.input,
        entity: `queue:${kv.queue}`,
        kind: 'queue.sample',
        attrs: { depth, workers: Number(kv.workers) || 0 },
      });
    }
    return out;
  },
};

/** Folds samples into the entity. `kinds` filters by prefix: only `queue.*` events reach it. */
export const queueReducer: Reducer = {
  name: 'queue',
  kinds: ['queue.'],
  reduce(entity, ev) {
    const depth = Number(ev.attrs?.depth ?? 0);
    entity.metrics.depth = depth;
    entity.metrics.workers = Number(ev.attrs?.workers ?? 0);
    entity.status = depth > 0 ? 'working' : 'idle';
    return entity; // returning null would delete the entity
  },
};

export default definePlugin({ name: 'queue', adapters: [queueAdapter], reducers: [queueReducer] });
```
<!-- /snippet -->

## Your own input type: `InputFactory`

Use it when no built-in input fits (a socket, a database cursor, a vendor SDK). `push` feeds the adapter named
in the input's config; stop on `signal`.

<!-- snippet: examples/snippets/ticker-input.ts -->
```ts
import { definePlugin, type InputFactory } from '@pixelagents/protocol';

/**
 * A custom input type. Config: `{ "id": "t", "type": "ticker", "adapter": "queue", "everySec": 2, "line": "queue=a depth=3" }`.
 * `push(raw)` hands one raw record to the adapter named in the config; stop when `signal` aborts
 * (config reload, shutdown). A promise returned from `start` is optional.
 */
export const tickerInput: InputFactory = {
  type: 'ticker',
  start(cfg, push, signal) {
    const every = Math.max(0.05, Number(cfg.everySec) || 5) * 1000;
    const line = typeof cfg.line === 'string' ? cfg.line : 'queue=demo depth=1';
    let n = 0;
    const timer = setInterval(() => push(`${line} n=${++n}`), every);
    signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  },
};

export default definePlugin({ name: 'ticker', inputs: [tickerInput] });
```
<!-- /snippet -->

Known limit: `CONFIG_SCHEMA.inputs` currently only accepts the five built-in `type`s, so a config with
`"type": "ticker"` fails validation until the schema gains an open variant (the test marks it `it.fails`).

## Classification rules, skins and behaviors (no code)

Rules decide how an entity looks (`view.skin`, `view.behavior`, `view.group`, `view.hidden`). Matching is
glob/regex per path, later rules win, `set` values are templates.

<!-- snippet: examples/snippets/rules.config.json -->
```json
{
  "classify": [
    { "name": "queues are minions", "match": { "kind": "queue" }, "set": { "view.behavior": "minion" } },
    { "name": "busy queues get the red skin", "match": { "kind": "queue", "metrics.depth": "???*" }, "set": { "view.skin": "red" } },
    { "name": "group by team, else by host", "match": { "labels.team": "*" }, "set": { "view.group": "{{labels.team}}" } },
    { "name": "hide probes", "match": { "id": "*:probe-*" }, "set": { "view.hidden": true } }
  ],
  "skins": { "red": { "palette": { "B": "#e5533d", "b": "#a8322a" } } }
}
```
<!-- /snippet -->

`config.behaviors` maps a status to a behavior name per behavior set (`default`, `minion`, yours):
`{ "default": { "working": "type", "idle": "idle", "*": "idle" } }`.

## Actor behaviors: `registerBehavior`

A behavior is `{ enter?, update, exit? }` over an ECS entity (`transform`, `animator`, `behavior.data`).
It must not allocate per frame. Reference it from `config.behaviors`.

<!-- snippet: examples/snippets/pace.client.ts -->
```ts
/**
 * Client plugin with an actor behavior. Reference it from config:
 *   "behaviors": { "default": { "working": "pace" } }
 * An actor is an ECS entity: `transform` (x, y, flip), `animator` (tag, playing), `behavior.data` (free scratch space).
 */
import type { BehaviorDef } from '../../packages/web/src/engine/behaviors.js';

/** Paces left and right 24 px around where it started, at 16 px/s. */
export const pace: BehaviorDef = {
  enter(a) {
    if (a.animator) { a.animator.tag = 'walk'; a.animator.playing = true; }
    a.behavior!.data.home = a.transform.x;
    a.behavior!.data.dir = 1;
  },
  update(a, dt) {
    const d = a.behavior!.data;
    const home = d.home as number;
    let x = a.transform.x + (d.dir as number) * 16 * dt;
    if (x > home + 24) { x = home + 24; d.dir = -1; }
    if (x < home - 24) { x = home - 24; d.dir = 1; }
    a.transform.x = x;
    a.transform.flip = (d.dir as number) < 0;
  },
  exit(a) {
    if (a.animator) a.animator.playing = false;
  },
};

export default { name: 'pace-demo', behaviors: { pace } };
```
<!-- /snippet -->

## Filters (shaders)

A filter is a factory `(params) => pixi Filter | null` registered under a name and enabled from `config.effects`
on a layer (`world`, `actors`, `ui`, `screen`). Inside the web package use `glFilter(fragment, uniforms)` from
`engine/filters.ts`; a plugin cannot import the engine, so the plugin API expects the host to expose pixi:
`globalThis.__pixelagents = { pixi }` (set in `packages/web/src/main.ts` before `loadClientPlugins`). The plugin
bundle imports nothing at runtime and builds `new Filter({ glProgram: GlProgram.from(...), resources: {
pxUniforms: new UniformGroup({...}) } })` from it, with the same vertex stage as `glFilter`.

Rules of thumb: write GLSL that is valid as WebGL1-compatible source (pixi adds the `in`/`out` defines): no
const arrays (unroll instead), no `#version`. Textures are premultiplied: divide by alpha before grading. Uniforms
are floats in the `pxUniforms` group. The filter area is the bounds of the layer's content, so full-frame
effects need content under them (see the notes in the effects report about the `screen` layer).

The smallest complete example (`hello-sepia`, parameter `amount`, default 0.6):

<!-- snippet: examples/hello-plugin/src/client/index.ts -->
```ts
/**
 * Browser half of the hello plugin: one filter, `hello-sepia`. Pixi comes from the host
 * (`globalThis.__pixelagents.pixi`), so the bundle imports nothing at runtime.
 */
import type { Filter } from 'pixi.js';

interface PixiLike {
  Filter: new (o: Record<string, unknown>) => Filter;
  GlProgram: { from(o: Record<string, unknown>): unknown };
  UniformGroup: new (u: Record<string, unknown>) => unknown;
}

const VERT = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void){
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void){ return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void){ gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }`;

const FRAG = `precision highp float;
in vec2 vTextureCoord; out vec4 finalColor;
uniform sampler2D uTexture; uniform float uAmount;
void main(void){
  vec4 c = texture(uTexture, vTextureCoord);
  float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 sepia = l * vec3(1.2, 1.0, 0.8);
  finalColor = vec4(mix(c.rgb, sepia, uAmount), c.a);
}`;

/** params: `amount` 0..1 (default 0.6). */
export function sepia(params: Record<string, unknown>): Filter {
  const pixi = (globalThis as { __pixelagents?: { pixi?: PixiLike } }).__pixelagents?.pixi;
  if (!pixi) throw new Error('hello: the host did not expose pixi');
  const a = typeof params.amount === 'number' ? Math.min(1, Math.max(0, params.amount)) : 0.6;
  return new pixi.Filter({
    glProgram: pixi.GlProgram.from({ vertex: VERT, fragment: FRAG, name: 'hello-sepia' }),
    resources: { pxUniforms: new pixi.UniformGroup({ uAmount: { value: a, type: 'f32' } }) },
  });
}

export default { name: 'hello', filters: { 'hello-sepia': sepia } };
```
<!-- /snippet -->

### The `effects` plugin

Add `@pixelagents/plugin-effects` to `plugins`. Parameters and defaults (out-of-range values are clamped, bad
types fall back to the default):

| Filter | Parameter | Default | Meaning |
|---|---|---|---|
| `crt` | `curvature` | 0.12 | barrel distortion, 0 = flat (0..0.5) |
| `crt` | `scanlines` | 0.18 | darkness of scanlines (0..1) |
| `crt` | `period` | 2 | scanline period in source pixels (1..8) |
| `crt` | `aberration` | 0.0015 | red/blue shift at the edges (0..0.02) |
| `crt` | `vignette` | 0.35 | corner darkening (0..1) |
| `daynight` | `hour` | -1 | forced hour 0..24; -1 = local time, refreshed every minute |
| `daynight` | `strength` | 1 | how much tint is applied (0..1.5) |
| `daynight` | `lightThreshold` | 0.78 | brightness above which a pixel is a light that keeps glowing at night |
| `daynight` | `lightBoost` | 1.25 | brightness multiplier of lights at night (1..3) |
| `glow` | `threshold` | 0.7 | luma above which pixels bloom (0..0.99) |
| `glow` | `strength` | 0.9 | intensity of the added light (0..4) |
| `glow` | `radius` | 2.5 | spread in source pixels (0.5..8) |
| `scanlines` | `intensity` | 0.22 | darkness of the lines (0..1) |
| `scanlines` | `period` | 2 | distance between lines (1..8) |
| `scanlines` | `phase` | 0 | pattern offset (0..8) |
| `palette` | `palette` | `"prototype"` | `gameboy`, `pico8` or `prototype` |
| `palette` | `colors` | `[]` | custom list of `"#rrggbb"`, overrides `palette` when it has 2+ entries |
| `palette` | `dither` | 0 | ordered 4x4 dithering (0..1) |
| `outline` | `color` | `"#1a1423"` | contour colour |
| `outline` | `thickness` | 1 | contour width in pixels (1..4) |
| `outline` | `alpha` | 1 | contour opacity (0..1) |
| `outline` | `diagonals` | `true` | also look at diagonal neighbours |

```json
{ "plugins": ["@pixelagents/plugin-effects"],
  "effects": [
    { "layer": "world",  "filter": "daynight", "params": { "hour": 22 } },
    { "layer": "world",  "filter": "glow", "params": { "threshold": 0.75 } },
    { "layer": "actors", "filter": "outline" }
  ] }
```

Check your own shaders the way the plugin does: `node plugins/effects/scripts/preview-check.mjs` mounts the real
engine in system Chrome, applies each filter, writes `fx-<name>.png` and measures frame cost. WGSL (WebGPU) is not
provided yet: the engine defaults to WebGL, where every built-in filter is GLSL.

## Growth strategies

When an office needs more floor, the world generator calls a strategy `(office, index, ctx)`. Register it from a
client plugin under `strategies` and list its name in `config.world.strategies`. The shape is the world's
`StrategyFn`; `ctx.free(c, r, oi)` says whether a tile can be taken, `ctx.rg` is the seeded rng (use it, never
`Math.random`, so the same seed gives the same town).

<!-- snippet: examples/snippets/column.client.ts -->
```ts
/**
 * A world growth strategy: how an office extends its footprint when it needs more room.
 * Enable it from config: `"world": { "strategies": ["columna"] }`. The generator calls it with the
 * office rectangle (tile units), its index `oi`, a grid of owners `cx.own` (own[r][c] = office index)
 * and a seeded rng, so the same seed gives the same town.
 */
import type { GrowCtx, OfficeDraft } from '../../packages/web/src/world/strategies.js';

export function columna(o: OfficeDraft, oi: number, cx: GrowCtx): void {
  const w = cx.rg.i(2, 3), h = cx.rg.i(3, 6);
  const x = o.tx + o.tw; // to the right of the office
  const y = o.ty + cx.rg.i(0, Math.max(0, o.th - h));
  for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (!cx.free(c, r, oi)) return; // all or nothing
  for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) (cx.own[r] as number[])[c] = oi;
}

export default { name: 'columna-demo', strategies: { columna } };
```
<!-- /snippet -->

## Sprites (`.px.json`) and skins

Sprites are pixel art as text: rows of equal length, `.` is transparent, every other character is a key of the
sprite's `palette`. `anchor` is the pivot, `fps` and `tags` drive the animator. Put files in a folder listed in
`config.assets` (watched, hot reloaded) or list their URLs under a client plugin's `sprites`. Later files
override earlier ones by name.

<!-- snippet: examples/snippets/pet.px.json -->
```json
{
  "px": 1,
  "sprites": [
    {
      "name": "pet.cat",
      "w": 8,
      "h": 6,
      "anchor": [4, 6],
      "fps": 4,
      "tags": { "idle": [0, 0], "walk": [0, 1] },
      "meta": { "kind": "pet" },
      "palette": { "F": "#e9a23b", "f": "#b8741f", "E": "#1a1423", "N": "#ff9d8a" },
      "frames": [
        [
          ".F....F.",
          ".FFFFFF.",
          ".FEFFEF.",
          ".FFNNFF.",
          "..FFFF.f",
          "..F..F.."
        ],
        [
          ".F....F.",
          ".FFFFFF.",
          ".FEFFEF.",
          ".FFNNFF.",
          "..FFFF.f",
          ".F....F."
        ]
      ]
    }
  ]
}
```
<!-- /snippet -->

Characters are built from parts (`char.<view>.<part>`) with palette keys that skins override (`H` hair, `S` skin,
`B` body, `b` body shadow, ...; see `CHARACTER_KEYS`). A skin is a palette override plus an optional accessory
overlay; rules choose it per entity:

<!-- snippet: examples/snippets/skins.config.json -->
```json
{
  "assets": ["~/.pixelagents/assets"],
  "skins": {
    "ocean": { "palette": { "B": "#2f6fb5", "b": "#1d4a7a", "H": "#222a35" } },
    "night-shift": { "palette": { "B": "#3b3346", "b": "#1a1423" }, "accessory": "headphones" }
  },
  "classify": [
    { "name": "skin by account", "match": { "labels.account": "*" }, "set": { "view.skin": "{{labels.account}}" } },
    { "name": "work account is ocean", "match": { "labels.account": "work" }, "set": { "view.skin": "ocean" } }
  ]
}
```
<!-- /snippet -->

## Testing your plugin

- Adapters and reducers are pure: call `parse`/`reduce` with a fake `now` and assert (see the tests next to each
  example). Assert privacy too: feed a record with a `SECRET` field and check it never shows up in the events.
- Start the real server in-process: `createServer(config, { plugins: [yourPlugin], tickMs: 0 })`, call
  `server.ingest(event)`, read `GET /api/state` (see `examples/hello-plugin/test/hello.test.ts`).
- Validate configs you ship against `CONFIG_SCHEMA` with Ajv 2020.
- Filters: mock `globalThis.__pixelagents.pixi` for unit tests and compile them for real with the preview script.
- Never touch the real `~/.pixelagents` in tests; use temp dirs.
