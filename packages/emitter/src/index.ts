/** Owner: W2. Hook emitter helpers (buildHookLine), hook installation and the `pixelagents agent` forwarder. */
export { buildHookLine, resolveRepo, nodeHookFs, type HookFs, type BuildOptions } from './hook-line.js';
export {
  installHooks,
  uninstallHooks,
  hooksStatus,
  mergeHooks,
  unmergeHooks,
  defaultEmitterPath,
  EMIT_MARKER,
  HOOK_EVENTS,
  type HooksOptions,
  type HooksResult,
  type HooksStatus,
} from './hooks.js';
export { startAgent, type AgentOptions, type AgentHandle, type AgentStats } from './agent.js';
export { renderService, installService, uninstallService, type ServiceSpec, type ServiceFile } from './service.js';
export { main as runCli } from './cli.js';
