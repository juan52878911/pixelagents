/**
 * pixelagents.config.json — everything is configurable here and from the web (PUT /api/config).
 * The JSON Schema in ./schema.ts must stay in sync with these types (test: schema.test.ts).
 */
export interface PaConfig {
  version: 1;
  server: ServerConfig;
  /** Where events come from. */
  inputs: InputConfig[];
  /** Server/client plugins: package names or paths to ESM modules. */
  plugins: string[];
  /** Ordered rules; every matching rule applies (later wins). Fills entity.view and labels. */
  classify: Rule[];
  /** How entities become offices. */
  groups: GroupsConfig;
  /** Status → behavior names, per behavior set. "default" is used when an entity has none. */
  behaviors: Record<string, BehaviorSet>;
  /** Skin name → palette overrides and accessory overlay. */
  skins: Record<string, SkinConfig>;
  world: WorldConfig;
  /** Extra asset directories (sprites, animations) on the server host, watched for changes. */
  assets: string[];
  /** Post-processing filters by layer. */
  effects: EffectConfig[];
  fun: FunConfig;
  timing: TimingConfig;
  /** Plugin-specific settings keyed by plugin name. */
  pluginConfig: Record<string, Record<string, unknown>>;
}

export interface ServerConfig {
  host: string; // default 127.0.0.1
  port: number; // default 4242
  /** Required for non-loopback ingest and hub federation. */
  token?: string;
  /** Logs and snapshots. Default ~/.pixelagents */
  dataDir?: string;
}

export type InputConfig =
  | { id: string; type: 'http'; adapter?: string; enabled?: boolean }
  | { id: string; type: 'file'; path: string; adapter: string; fromStart?: boolean; enabled?: boolean; options?: Record<string, unknown> }
  | { id: string; type: 'command'; command: string; args?: string[]; adapter: string; restartSec?: number; enabled?: boolean; options?: Record<string, unknown> }
  | { id: string; type: 'poll'; command?: string; args?: string[]; url?: string; everySec: number; adapter: string; enabled?: boolean; options?: Record<string, unknown> }
  | { id: string; type: 'hub'; url: string; token?: string; enabled?: boolean };

/**
 * `match` keys are paths into the entity: "kind", "status", "labels.account", "parent", "metrics.cost_usd".
 * Values are globs ("kindling-*"), arrays of globs (any), or "/regex/".
 * `set` keys are paths too: "view.group", "view.skin", "labels.team"; values may use {{labels.host}} templates.
 */
export interface Rule {
  name?: string;
  match: Record<string, string | string[]>;
  set: Record<string, unknown>;
}

export interface GroupsConfig {
  /** Template for the group id, e.g. "{{labels.host}}". Entities with an explicit view.group keep it. */
  by: string;
  /** Template for the label shown on the office sign. */
  label?: string;
  /** Group id glob → room kind ("office", "lab", "server"). First match wins; default "office". */
  kinds?: Record<string, string>;
  /** Group id glob → sub-grouping template inside the office (desks clustered by repo by default). */
  zones?: string;
}

/** status → behavior name (registered by the web engine or plugins). "*" is the fallback. */
export type BehaviorSet = Record<string, string>;

export interface SkinConfig {
  /** Palette key → color, applied over the base character palette. */
  palette?: Record<string, string>;
  /** Accessory overlay sprite name (assets), e.g. "acc.headphones". */
  accessory?: string;
  /** Item carried on arrival ("item.briefcase"). */
  item?: string;
  /** Base character sprite set, default "char". */
  base?: string;
}

export interface WorldConfig {
  /** World generator name (core: "town"). */
  generator: string;
  /** "daily" (date seed), "fixed:<text>" or "random". */
  seed: string;
  /** Growth strategy names to pick from (core: alas, escalera, mancha, mordida, cueva). Empty = all. */
  strategies: string[];
  /** "auto" by month, or a season name. */
  season: string;
  /** Logical resolution; the canvas scales it with nearest-neighbour. */
  width: number;
  height: number;
  /** Max FPS of the render loop. */
  fps: number;
  /** Play the builders animation when the world (re)generates. */
  builders: boolean;
}

export interface EffectConfig {
  /** "world" | "actors" | "ui" | "screen" */
  layer: string;
  /** Filter name registered by the engine or a plugin ("crt", "daynight", "glow"). */
  filter: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
}

export interface FunConfig {
  decor: boolean;
  /** true = all, false = none, or a list of gag names. */
  gags: boolean | string[];
  emojis: boolean;
  /** Seconds between random gags/emojis. */
  everySec: number;
}

export interface TimingConfig {
  /** Idle → sleeping after this many seconds without events. */
  sleepAfterSec: number;
  /** Remove entities with no events after this many seconds (ended ones go sooner). */
  forgetAfterSec: number;
  /** Ended entities linger this long so they can play their exit. */
  endedLingerSec: number;
  /** Entity history length. */
  historyMax: number;
}
