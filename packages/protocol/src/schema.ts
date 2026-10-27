/**
 * JSON Schema (draft 2020-12) of PaConfig. The server validates with it and the web builds its
 * settings forms from it (titles/descriptions are UI text). Keep in sync with config.ts.
 */
const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const bool = { type: 'boolean' } as const;
const strMap = { type: 'object', additionalProperties: { type: 'string' } } as const;
const anyMap = { type: 'object', additionalProperties: true } as const;

const inputBase = {
  id: { ...str, title: 'Id', description: 'Becomes the event source.' },
  enabled: { ...bool, default: true },
  adapter: { ...str, title: 'Adapter', description: 'Plugin adapter that parses each record.' },
  options: anyMap,
};

export const CONFIG_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://pixelagents.dev/schema/config.json',
  title: 'pixelagents configuration',
  type: 'object',
  required: ['version', 'server', 'inputs', 'plugins', 'classify', 'groups', 'behaviors', 'skins', 'world', 'assets', 'effects', 'fun', 'timing', 'pluginConfig'],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    server: {
      title: 'Server', type: 'object', required: ['host', 'port'], additionalProperties: false,
      properties: {
        host: { ...str, default: '127.0.0.1' },
        port: { type: 'integer', minimum: 1, maximum: 65535, default: 4242 },
        token: { ...str, description: 'Required for remote ingest and federation.' },
        dataDir: str,
      },
    },
    inputs: {
      title: 'Sources', type: 'array',
      items: {
        oneOf: [
          { title: 'HTTP ingest', type: 'object', required: ['id', 'type'], additionalProperties: false, properties: { ...inputBase, type: { const: 'http' } } },
          { title: 'Tail a file', type: 'object', required: ['id', 'type', 'path', 'adapter'], additionalProperties: false, properties: { ...inputBase, type: { const: 'file' }, path: str, fromStart: bool } },
          { title: 'Stream from a command', type: 'object', required: ['id', 'type', 'command', 'adapter'], additionalProperties: false, properties: { ...inputBase, type: { const: 'command' }, command: str, args: { type: 'array', items: str }, restartSec: num } },
          { title: 'Poll a command or URL', type: 'object', required: ['id', 'type', 'everySec', 'adapter'], additionalProperties: false, properties: { ...inputBase, type: { const: 'poll' }, command: str, args: { type: 'array', items: str }, url: str, everySec: { type: 'number', minimum: 1 } } },
          { title: 'Another pixelagents hub', type: 'object', required: ['id', 'type', 'url'], additionalProperties: false, properties: { id: str, enabled: bool, type: { const: 'hub' }, url: str, token: str } },
        ],
      },
    },
    plugins: { title: 'Plugins', type: 'array', items: str },
    classify: {
      title: 'Classification rules', type: 'array',
      items: {
        type: 'object', required: ['match', 'set'], additionalProperties: false,
        properties: {
          name: str,
          match: { type: 'object', additionalProperties: { oneOf: [str, { type: 'array', items: str }] } },
          set: anyMap,
        },
      },
    },
    groups: {
      title: 'Offices', type: 'object', required: ['by'], additionalProperties: false,
      properties: { by: { ...str, default: '{{labels.host}}' }, label: str, kinds: strMap, zones: str },
    },
    behaviors: { title: 'Behaviors', type: 'object', additionalProperties: strMap },
    skins: {
      title: 'Skins', type: 'object',
      additionalProperties: {
        type: 'object', additionalProperties: false,
        properties: { palette: strMap, accessory: str, item: str, base: str },
      },
    },
    world: {
      title: 'World', type: 'object', additionalProperties: false,
      required: ['generator', 'seed', 'strategies', 'season', 'width', 'height', 'fps', 'builders'],
      properties: {
        generator: str,
        seed: { ...str, default: 'daily' },
        strategies: { type: 'array', items: str },
        season: { ...str, default: 'auto' },
        width: { type: 'integer', minimum: 160, maximum: 1920 },
        height: { type: 'integer', minimum: 120, maximum: 1080 },
        fps: { type: 'integer', minimum: 10, maximum: 144 },
        builders: bool,
      },
    },
    assets: { title: 'Asset folders', type: 'array', items: str },
    effects: {
      title: 'Effects', type: 'array',
      items: {
        type: 'object', required: ['layer', 'filter'], additionalProperties: false,
        properties: { layer: { enum: ['world', 'actors', 'ui', 'screen'] }, filter: str, enabled: bool, params: anyMap },
      },
    },
    fun: {
      title: 'Fun', type: 'object', required: ['decor', 'gags', 'emojis', 'everySec'], additionalProperties: false,
      properties: { decor: bool, gags: { oneOf: [bool, { type: 'array', items: str }] }, emojis: bool, everySec: { type: 'number', minimum: 1 } },
    },
    timing: {
      title: 'Timing', type: 'object', required: ['sleepAfterSec', 'forgetAfterSec', 'endedLingerSec', 'historyMax'], additionalProperties: false,
      properties: {
        sleepAfterSec: { type: 'number', minimum: 1 },
        forgetAfterSec: { type: 'number', minimum: 1 },
        endedLingerSec: { type: 'number', minimum: 0 },
        historyMax: { type: 'integer', minimum: 1, maximum: 1000 },
      },
    },
    pluginConfig: { title: 'Plugin settings', type: 'object', additionalProperties: anyMap },
  },
} as const;
