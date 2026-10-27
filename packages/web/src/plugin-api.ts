/**
 * Client plugin API. Owner: W3 defines the engine types it exposes (Actor, World, Engine);
 * W10 adds filters and docs. Plugins export `default defineClientPlugin({...})` from client.js.
 */
export interface ClientPlugin {
  name: string;
}
export function defineClientPlugin<T extends ClientPlugin>(p: T): T {
  return p;
}
