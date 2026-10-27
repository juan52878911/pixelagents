// Merge/unmerge our hook entries in <configDir>/settings.json with a marker and a one-time backup.
// Ported from design/reference/hooks-config.ts. Never touches hooks that are not ours.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EMIT_MARKER = 'pixelagents-emit-marker';
export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'Stop',
  'PreToolUse',
  'PostToolUse',
  'SubagentStart',
  'SubagentStop',
  'Notification',
] as const;
const MATCHER_EVENTS = new Set<string>(['PreToolUse', 'PostToolUse']);

export interface HookCommand {
  type: 'command';
  command: string;
}
export interface HookMatcherEntry {
  matcher?: string;
  hooks: HookCommand[];
}
export interface Settings {
  hooks?: Record<string, HookMatcherEntry[]>;
  [key: string]: unknown;
}

/** Absolute path of bin/emit.js (source layout or dist/ layout). */
export function defaultEmitterPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of [
    ['..', 'bin', 'emit.js'],
    ['..', '..', 'bin', 'emit.js'],
  ]) {
    const p = join(here, ...rel);
    if (existsSync(p)) return p;
  }
  return join(here, '..', 'bin', 'emit.js');
}

export function buildCommand(emitterPath: string, account?: string): string {
  if (account !== undefined && !/^[A-Za-z0-9_.@-]+$/.test(account)) {
    throw new Error(`invalid account name: ${JSON.stringify(account)} (use letters, digits, _ . @ -)`);
  }
  const env = account ? `PIXELAGENTS_ACCOUNT=${account} ` : '';
  return `${env}node ${JSON.stringify(emitterPath)} #${EMIT_MARKER}`;
}

const hasMarker = (e: HookMatcherEntry): boolean =>
  Array.isArray(e?.hooks) && e.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(EMIT_MARKER));

export function mergeHooks(settings: Settings, emitterPath: string, account?: string): Settings {
  const out: Settings = { ...settings, hooks: { ...(settings.hooks ?? {}) } };
  const command = buildCommand(emitterPath, account);
  for (const event of HOOK_EVENTS) {
    const existing = out.hooks![event] ?? [];
    const ours: HookMatcherEntry = MATCHER_EVENTS.has(event)
      ? { matcher: '*', hooks: [{ type: 'command', command }] }
      : { hooks: [{ type: 'command', command }] };
    out.hooks![event] = [...existing.filter((e) => !hasMarker(e)), ours];
  }
  return out;
}

export function unmergeHooks(settings: Settings): Settings {
  if (!settings.hooks) return { ...settings };
  const out: Settings = { ...settings, hooks: {} };
  for (const [event, entries] of Object.entries(settings.hooks)) {
    const rest = entries.filter((e) => !hasMarker(e));
    if (rest.length > 0) out.hooks![event] = rest;
  }
  if (Object.keys(out.hooks!).length === 0) delete out.hooks;
  return out;
}

export const backupPath = (settingsPath: string): string => `${settingsPath}.pixelagents-backup`;

/** Absent file -> {}. Unparseable file THROWS: never rewrite what we cannot read. */
export function readSettings(settingsPath: string): Settings {
  if (!existsSync(settingsPath)) return {};
  const raw = readFileSync(settingsPath, 'utf8');
  if (raw.trim() === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${settingsPath} is not valid JSON (comments or trailing commas?). Nothing was modified.`);
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Settings) : {};
}

function writeSettings(settingsPath: string, s: Settings): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.pixelagents-tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
  renameSync(tmp, settingsPath);
}

export interface HooksOptions {
  /** Absolute emit.js path baked into the commands. */
  emitterPath?: string;
  /** Fixes PIXELAGENTS_ACCOUNT in the hook command. */
  account?: string;
}
export interface HooksResult {
  configDir: string;
  settingsPath: string;
  changed: boolean;
  backedUp?: boolean;
}

/** Config dirs to act on: the given ones, else $CLAUDE_CONFIG_DIR, else ~/.claude. */
export function resolveConfigDirs(dirs: string[] | undefined, env = process.env): string[] {
  if (dirs && dirs.length > 0) return dirs.map((d) => resolve(d));
  return [resolve(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'))];
}

const asList = (d: string | string[] | undefined): string[] | undefined =>
  d === undefined ? undefined : Array.isArray(d) ? d : [d];

/** Idempotent. One result per config dir (one dir per account). */
export function installHooks(configDirs?: string | string[], opts: HooksOptions = {}): HooksResult[] {
  const emitterPath = resolve(opts.emitterPath ?? defaultEmitterPath());
  const dirs = resolveConfigDirs(asList(configDirs));
  buildCommand(emitterPath, opts.account); // validate before touching anything
  const results: HooksResult[] = [];
  for (const configDir of dirs) {
    const settingsPath = join(configDir, 'settings.json');
    const before = readSettings(settingsPath); // validates before any write
    const after = mergeHooks(before, emitterPath, opts.account);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    let backedUp = false;
    if (changed) {
      if (existsSync(settingsPath) && !existsSync(backupPath(settingsPath))) {
        copyFileSync(settingsPath, backupPath(settingsPath));
        backedUp = true;
      }
      writeSettings(settingsPath, after);
    }
    results.push({ configDir, settingsPath, changed, backedUp });
  }
  return results;
}

export function uninstallHooks(configDirs?: string | string[]): HooksResult[] {
  return resolveConfigDirs(asList(configDirs)).map((configDir) => {
    const settingsPath = join(configDir, 'settings.json');
    if (!existsSync(settingsPath)) return { configDir, settingsPath, changed: false };
    const before = readSettings(settingsPath);
    const after = unmergeHooks(before);
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    if (changed) writeSettings(settingsPath, after);
    return { configDir, settingsPath, changed };
  });
}

export interface HooksStatus {
  configDir: string;
  settingsPath: string;
  installed: boolean;
  events: string[];
  missing: string[];
  account?: string;
  emitterPath?: string;
  emitterExists?: boolean;
  backup: boolean;
}

export function hooksStatus(configDirs?: string | string[]): HooksStatus[] {
  return resolveConfigDirs(asList(configDirs)).map((configDir) => {
    const settingsPath = join(configDir, 'settings.json');
    const s = readSettings(settingsPath);
    const events: string[] = [];
    let account: string | undefined;
    let emitterPath: string | undefined;
    for (const ev of HOOK_EVENTS) {
      const entry = (s.hooks?.[ev] ?? []).find(hasMarker);
      if (!entry) continue;
      events.push(ev);
      const cmd = entry.hooks.find((h) => h.command?.includes(EMIT_MARKER))?.command ?? '';
      account ??= /PIXELAGENTS_ACCOUNT=(\S+)/.exec(cmd)?.[1];
      const m = /node ("(?:[^"\\]|\\.)*")/.exec(cmd);
      if (m && !emitterPath) {
        try {
          emitterPath = JSON.parse(m[1]!) as string;
        } catch {
          /* ignore */
        }
      }
    }
    return {
      configDir,
      settingsPath,
      installed: events.length === HOOK_EVENTS.length,
      events,
      missing: HOOK_EVENTS.filter((e) => !events.includes(e)),
      account,
      emitterPath,
      emitterExists: emitterPath ? existsSync(emitterPath) : undefined,
      backup: existsSync(backupPath(settingsPath)),
    };
  });
}
