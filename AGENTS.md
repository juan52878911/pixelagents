# AGENTS.md — pixelagents

Live monitor of AI coding agents drawn as a pixel-art town of offices. Any source of events goes in,
entities come out, and the world shows at a glance what every agent is doing right now.

## Architecture (contract — read before coding)

```
sources ──► inputs (http|file|command|poll|hub) ──► adapters ──► PaEvent
PaEvent ──► reducers (core, then plugins) ──► Entity ──► classify rules ──► entity.view + groups
state ──► SSE /events (snapshot, then Delta at ≤10 Hz) ──► web (PixiJS v8) ──► world, actors, inspector
```

- `packages/protocol` — **the contract**: `PaEvent`, `HookLine`, `Entity`, `Group`, `Delta`, `PaConfig` +
  `CONFIG_SCHEMA`, plugin API (`definePlugin`, `Adapter`, `Reducer`, `InputFactory`), sprite files
  (`PxFile`), rule engine (`matches`, `applyRules`, `renderTemplate`), `DEFAULT_CONFIG`. Changing it
  needs the orchestrator: other workers build on it in parallel.
- `packages/server` — Node HTTP server (no framework): inputs, adapters registry, reducers, state,
  classification, SSE, `/api/config` (GET/PUT, schema-validated, hot reload, written back to disk),
  `/api/assets`, `/plugins/<name>/client.js`, persistence in `dataDir`.
- `packages/emitter` — `bin/emit.js` (Claude Code hook, plain JS, node built-ins only, <30 ms, always
  exit 0) and `pixelagents agent` (forwards a machine's events to a hub over HTTP with a token).
- `packages/web` — Vite + PixiJS v8. Low-res render target scaled with nearest; ECS-lite engine;
  sprite compiler for `.px.json`; world generator; behaviors; inspector; settings UI.
- `plugins/*` — official plugins, each `src/index.ts` (server, `definePlugin`) and optional
  `src/client/index.ts` (browser, `defineClientPlugin`).
- `assets/` — default sprites and animations as `.px.json` files.
- `design/prototype/` — the canvas prototype everything is ported from: `prototype.html` (open in a
  browser), `world.js` (procedural town), `pop.js` (pop-culture decor, gags, emojis),
  `check-world.cjs`, `check-pop.cjs`. Port behaviour and art faithfully; do not import these files.
- `fixtures/` — synthetic samples of every source (`node scripts/gen-fixtures.mjs`). Tests use them.

## Ownership (parallel work)

Each worker owns its folders and touches nothing else. Root `package.json`/lockfile: only add your
package's dependencies with `npm install -w <pkg> <dep>`; never edit another package. If you need a
change in `packages/protocol`, stop and send a blocker/question with the exact change.

## Conventions

- TypeScript strict, ESM, Node ≥ 20 (CI runs 20 and 22). No `node:sqlite`.
- Packages export their TS source (`"exports": "./src/index.ts"`); run with `tsx`, test with vitest,
  bundle for release with esbuild. Keep runtime dependencies minimal and justified; the emitter has none.
- Tests: fixtures + injectable clocks/paths. Never touch the real `~/.pixelagents`, `~/.claude` or any
  user setting in tests; use temp dirs.
- Performance budgets: emitter < 30 ms per hook; server < 5 % CPU at 200 events/s; web 60 FPS with 50
  agents and 3 effects. Measure, don't guess.
- Pixel art only: sprites are pixels (`.px.json` or PNG); no vector shapes for characters.
- Generic core: nothing in `packages/*` may know about a specific person, company, host or account.
  Product-specific behaviour lives in plugins and in the user's config.

## Privacy (the trust story)

Events carry tool names, paths, short commands (≤120 chars), session ids, numbers. **Never** prompt
text, model answers, file contents, tool outputs or env values. Some sources contain them (nod's
`prompt.submit.text`, `turn.end.answer`; hook payloads' `prompt`, `tool_input.content`,
`tool_response`): adapters must not read those fields. Tests assert it with the `SECRET` strings in
fixtures.

## Commands

```bash
npm install
npm run typecheck      # node packages + web
npm test               # vitest
npm run build          # all packages that have a build
npm run dev            # server (once implemented)
npm run dev -w @pixelagents/web
node scripts/gen-fixtures.mjs
node design/prototype/check-world.cjs   # prototype invariants (reference)
```

Definition of done for any change: `npm run check` and `npm run build` green.
