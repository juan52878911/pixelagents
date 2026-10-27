#!/usr/bin/env node
// Standalone, dependency-free hook emitter -- what installed hooks actually
// invoke (see src/hooks-config.ts). Plain JS on purpose: no tsx/typescript
// loader in the startup path, so this runs in a few ms instead of the
// ~270ms the old `node bin/pixelagents.js emit` (tsx shim) cost. Since
// PreToolUse hooks block the host agent's tool calls, that latency landed
// on every single tool use -- this file exists to remove it.
//
// Logic MUST stay identical to src/emit.ts's buildEvent -- that's a second,
// TypeScript copy used by the server/tests/CLI. test/emit-parity.test.ts
// runs both implementations over the same fixtures and fails on drift.
//
// Hook JSON on stdin -> one event line appended to
// $PIXELAGENTS_DIR/events.jsonl. MUST NEVER throw past main() / exit
// non-zero -- a broken visualizer must never break the user's Claude Code.
//
// Privacy: only file_path/pattern/command/query/url ever get read out of
// tool_input, truncated to 120 chars. Content, prompt and env fields are
// never read.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { basename, join } from "node:path";

const MAX_DETAIL = 120;

// hook_event_name -> kind, for hooks with a 1:1 mapping (design.md §4).
// PreToolUse/PostToolUse and Notification are handled specially below
// because their kind additionally depends on tool_name / message content.
const HOOK_KIND_MAP = {
  SessionStart: "session.start",
  SessionEnd: "session.end",
  UserPromptSubmit: "turn.start",
  Stop: "turn.end",
  PreToolUse: "tool.pre",
  PostToolUse: "tool.post",
  SubagentStart: "fork.start",
  SubagentStop: "fork.end",
};

function pixelagentsDir() {
  return process.env.PIXELAGENTS_DIR || join(homedir(), ".pixelagents");
}

function eventsFilePath(dir) {
  return join(dir, "events.jsonl");
}

function truncate(value, max = MAX_DETAIL) {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const firstLine = value.split("\n")[0] ?? "";
  return firstLine.length > max ? firstLine.slice(0, max) : firstLine;
}

// Detail extraction per tool. NEVER reads "content", "prompt", or any field
// other than the ones explicitly named here.
function detailForTool(tool, input) {
  switch (tool) {
    case "Read":
    case "Edit":
    case "Write":
      return truncate(input.file_path);
    case "Grep":
    case "Glob":
      return truncate(typeof input.pattern === "string" ? input.pattern : input.path);
    case "Bash":
      return truncate(input.command);
    case "WebSearch":
      return truncate(input.query);
    case "WebFetch":
      return truncate(input.url);
    default:
      return undefined;
  }
}

// Which Claude account this session runs under: PIXELAGENTS_ACCOUNT wins,
// else the basename of CLAUDE_CONFIG_DIR (ws sets one per org), else the
// default ~/.claude, labelled "personal".
function accountName() {
  const explicit = process.env.PIXELAGENTS_ACCOUNT;
  if (explicit) return explicit;
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  return configDir ? basename(configDir.replace(/\/+$/, "")) : "personal";
}

function hostName() {
  try {
    return process.env.PIXELAGENTS_HOST || hostname().split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

function safeUsername() {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || "unknown";
  }
}

// Pure mapping from a parsed Claude Code hook payload to a PixelEvent, or
// null if the payload doesn't look like a hook payload at all. Mirrors
// src/emit.ts's buildEvent exactly (see test/emit-parity.test.ts).
function buildEvent(payload, now) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload;
  const hookName = p.hook_event_name;
  if (typeof hookName !== "string" || hookName.length === 0) return null;

  const cwd = typeof p.cwd === "string" && p.cwd.length > 0 ? p.cwd : process.cwd();
  const base = {
    ts: now(),
    session: typeof p.session_id === "string" ? p.session_id : "unknown",
    agent: safeUsername(),
    account: accountName(),
    host: hostName(),
    source: "claude-code",
    cwd,
    repo: basename(cwd) || cwd,
  };

  if (hookName === "Notification") {
    const message = typeof p.message === "string" ? p.message : "";
    const kind = /permission/i.test(message) ? "waiting.permission" : "waiting.human";
    return { ...base, kind };
  }

  if (hookName === "PreToolUse" || hookName === "PostToolUse") {
    const kind = hookName === "PreToolUse" ? "tool.pre" : "tool.post";
    const tool = typeof p.tool_name === "string" && p.tool_name.length > 0 ? p.tool_name : "unknown";
    const input = p.tool_input && typeof p.tool_input === "object" ? p.tool_input : {};
    return { ...base, kind, tool, detail: detailForTool(tool, input) };
  }

  const mapped = HOOK_KIND_MAP[hookName];
  if (mapped) {
    return { ...base, kind: mapped };
  }

  // Unknown hook: still emit, kind "other", tool set to the hook name so it
  // is visible in the feed instead of being silently dropped.
  return { ...base, kind: "other", tool: hookName };
}

function appendEvent(dir, event) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(eventsFilePath(dir), JSON.stringify(event) + "\n");
}

function readStdinSync() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  try {
    const raw = readStdinSync();
    if (!raw.trim()) return;
    const payload = JSON.parse(raw);
    const event = buildEvent(payload, () => new Date().toISOString());
    if (!event) return;
    appendEvent(pixelagentsDir(), event);
  } catch {
    // Silent by design -- a broken emitter must never break the host.
  }
}

main();
