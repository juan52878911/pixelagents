import type { PaConfig } from './config.js';
import type { Entity } from './entity.js';
import type { PaEvent } from './events.js';

/** What an adapter gets with each raw record. */
export interface AdapterContext {
  /** The input id (becomes PaEvent.source). */
  input: string;
  /** Input `options` from config. */
  options: Record<string, unknown>;
  /** Now, injectable for tests. */
  now(): Date;
}

/**
 * Turns one raw record into events. `raw` is a parsed JSON value when the line/body is JSON,
 * otherwise the raw string (poll/command outputs that are plain text).
 */
export interface Adapter {
  name: string;
  parse(raw: unknown, ctx: AdapterContext): PaEvent[];
}

export interface ReduceContext {
  config: PaConfig;
  now(): Date;
  get(id: string): Entity | undefined;
}

/**
 * Folds an event into an entity. Return the updated entity, or null to delete it.
 * Reducers run in order: core first, then plugins. `kinds` filters by kind prefix ("vm." matches "vm.state").
 */
export interface Reducer {
  name: string;
  kinds?: string[];
  reduce(entity: Entity, ev: PaEvent, ctx: ReduceContext): Entity | null;
}

/** A custom input type (beyond http/file/command/poll/hub). Emit raw records through `push`. */
export interface InputFactory {
  type: string;
  start(cfg: Record<string, unknown>, push: (raw: unknown) => void, signal: AbortSignal): void | Promise<void>;
}

export interface ServerPlugin {
  name: string;
  adapters?: Adapter[];
  reducers?: Reducer[];
  inputs?: InputFactory[];
  /** Default rules/skins/behaviors merged under the user's config. */
  defaults?: Partial<PaConfig>;
  /** Served to the browser at /plugins/<name>/client.js when present (absolute path). */
  clientEntry?: string;
  /** Called every second; may emit synthetic events (timers, decay). */
  tick?(ctx: ReduceContext): PaEvent[];
}

export function definePlugin<T extends ServerPlugin>(plugin: T): T {
  return plugin;
}
