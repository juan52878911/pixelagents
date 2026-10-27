// Merge/unmerge our 8 hook entries into a Claude Code settings.json object,
// plus file helpers (backup, idempotent install/uninstall). Never touches
// hooks that aren't ours.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EMIT_MARKER = "pixelagents-emit-marker";

// The distinct hook_event_name values used by the event contract
// (design.md §4): PreToolUse/PostToolUse feed tool.pre/tool.post,
// Notification feeds both waiting.human and waiting.permission (dispatched
// on message content inside emit.ts), the rest map 1:1.
export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "Stop",
  "PreToolUse",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "Notification",
] as const;

// Only these two hook types are matched by tool name in Claude Code's
// settings.json schema; the rest fire unconditionally and have no matcher.
const MATCHER_EVENTS = new Set<string>(["PreToolUse", "PostToolUse"]);

export interface HookCommand {
  type: "command";
  command: string;
}

export interface HookMatcherEntry {
  matcher?: string;
  hooks: HookCommand[];
}

export type HooksSection = Record<string, HookMatcherEntry[]>;

export interface Settings {
  hooks?: HooksSection;
  [key: string]: unknown;
}

/**
 * Absolute path to the installed emitter entry point, resolved at install
 * time relative to this module.
 *
 * This points at `bin/emit.js` -- a standalone, dependency-free JS file
 * (no tsx/typescript loader) -- rather than `bin/pixelagents.js emit`.
 * PreToolUse hooks block the host agent's tool calls, so emitter startup
 * latency lands on every tool use; going through the tsx shim measured
 * ~271ms per invocation, `bin/emit.js` measures well under 50ms.
 *
 * CAVEAT (npx installs): `npx pixelagents install-hooks` may run from a
 * temporary npx cache directory (e.g. ~/.npm/_npx/<hash>/...). The
 * absolute path baked into the hook command below is resolved AT INSTALL
 * TIME to wherever this package currently lives on disk. If npx's cache is
 * later evicted, or a different version resolves to a different cache
 * directory, the previously installed hook command will point at a path
 * that no longer exists -- the hook will then silently no-op (emit always
 * exits 0, even on error, by design). Users who want durable hooks should
 * `npm i -g pixelagents` (or keep a persistent local checkout) and re-run
 * `install-hooks` after upgrades.
 *
 * This module runs either straight from source (`.../src/hooks-config.ts`,
 * dev checkout / tsx) or compiled (`.../dist/src/hooks-config.js`, a real
 * npm install -- see tsconfig.build.json). `bin/emit.js` itself is never
 * compiled (it's already plain, dependency-free JS) and always lives at
 * `<package root>/bin/emit.js`, so the right "up" count from `here` differs
 * between the two layouts. Check both candidates rather than assume one.
 */
export function defaultEmitterPath(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // .../src or .../dist/src
  const devPath = join(here, "..", "bin", "emit.js"); // source layout
  if (existsSync(devPath)) return devPath;
  const distPath = join(here, "..", "..", "bin", "emit.js"); // compiled (dist/src -> root)
  if (existsSync(distPath)) return distPath;
  return devPath;
}

/** Builds the shell command for a hook entry. Marker is a comment-arg so
 * uninstall can find (and only remove) entries that are ours. bin/emit.js
 * is a standalone entry point (no subcommand routing needed). */
export function buildCommand(emitterPath: string): string {
  return `node ${JSON.stringify(emitterPath)} #${EMIT_MARKER}`;
}

function hasMarker(entry: HookMatcherEntry): boolean {
  return entry.hooks.some((h) => typeof h.command === "string" && h.command.includes(EMIT_MARKER));
}

/** Merge our hook entries into `settings`, returning a new object. Removes
 * any previous entry of ours first (by marker), so re-running install is a
 * no-op / update-in-place rather than accumulating duplicates. */
export function mergeHooks(settings: Settings, emitterPath: string): Settings {
  const out: Settings = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  const command = buildCommand(emitterPath);

  for (const event of HOOK_EVENTS) {
    const existing = out.hooks![event] ?? [];
    const withoutOurs = existing.filter((e) => !hasMarker(e));
    const ours: HookMatcherEntry = MATCHER_EVENTS.has(event)
      ? { matcher: "*", hooks: [{ type: "command", command }] }
      : { hooks: [{ type: "command", command }] };
    out.hooks![event] = [...withoutOurs, ours];
  }

  return out;
}

/** Remove exactly our entries (by marker) from `settings`, returning a new
 * object. Never touches entries that aren't ours. */
export function unmergeHooks(settings: Settings): Settings {
  if (!settings.hooks) return { ...settings };
  const out: Settings = { ...settings, hooks: {} };

  for (const [event, entries] of Object.entries(settings.hooks)) {
    const remaining = entries.filter((e) => !hasMarker(e));
    if (remaining.length > 0) out.hooks![event] = remaining;
  }

  if (Object.keys(out.hooks!).length === 0) delete out.hooks;
  return out;
}

export function backupPath(settingsPath: string): string {
  return `${settingsPath}.pixelagents-backup`;
}

/**
 * Reads the settings file. An ABSENT file is fine (fresh install → `{}`).
 * A file that exists but doesn't parse as strict JSON (users commonly have
 * `//` comments or trailing commas) THROWS — silently treating it as `{}`
 * would make install-hooks rewrite the file with only our hooks, destroying
 * the user's permissions/env/other hooks (pre-launch review finding #3).
 */
export function readSettings(settingsPath: string): Settings {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, "utf8");
  if (raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${settingsPath} exists but is not valid JSON (comments or trailing ` +
        `commas?). Fix it or pass --settings <path>. Nothing was modified.`,
    );
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Settings)
    : {};
}

export function writeSettings(settingsPath: string, settings: Settings): void {
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

/** Backs up settingsPath to its .pixelagents-backup sibling, but only the
 * first time (never overwrites an existing backup). Returns whether a
 * backup was (newly) created. */
export function ensureBackup(settingsPath: string): boolean {
  if (existsSync(settingsPath) && !existsSync(backupPath(settingsPath))) {
    copyFileSync(settingsPath, backupPath(settingsPath));
    return true;
  }
  return false;
}

export interface InstallResult {
  backedUp: boolean;
  settingsPath: string;
  emitterPath: string;
}

/** Idempotent: safe to call twice, never duplicates entries. */
export function installHooks(settingsPath: string, emitterPath: string = defaultEmitterPath()): InstallResult {
  // Read (and validate) BEFORE any write: an unparseable settings file must
  // abort the install with the file — and its backup slot — untouched.
  const settings = readSettings(settingsPath);
  const backedUp = ensureBackup(settingsPath);
  const merged = mergeHooks(settings, emitterPath);
  writeSettings(settingsPath, merged);
  return { backedUp, settingsPath, emitterPath };
}

export interface UninstallResult {
  changed: boolean;
  settingsPath: string;
}

/** Removes only entries containing our marker. Safe to call on a settings
 * file that never had our hooks installed (no-op). */
export function uninstallHooks(settingsPath: string): UninstallResult {
  if (!existsSync(settingsPath)) return { changed: false, settingsPath };
  const before = readSettings(settingsPath);
  const after = unmergeHooks(before);
  const changed = JSON.stringify(before) !== JSON.stringify(after);
  if (changed) writeSettings(settingsPath, after);
  return { changed, settingsPath };
}
