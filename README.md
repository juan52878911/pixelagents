# pixelagents

Watch your AI coding agents work, live, as a pixel-art town.

Every agent is an NPC at a desk: you see at a glance which tool it is using, on which file or
command, for how long, how much it costs and whether it is waiting for you. Offices, skins and
animations come from rules over the agents' labels (machine, account, repo, anything a source
reports), and everything — sources, rules, sprites, behaviors, shaders — is configurable from the web
UI or with plugins.

> Status: under construction. See [`AGENTS.md`](AGENTS.md) for the architecture.

## Quick start

Node 20 or newer. Nothing to clone or build:

```bash
npx pixelagents demo --port 4242      # a sample session on a loop, no setup: open http://localhost:4242
```

To watch your own Claude Code sessions:

```bash
npx pixelagents hooks install         # adds the pixelagents hooks to ~/.claude/settings.json (backup kept)
npx pixelagents serve                 # http://127.0.0.1:4242, config in ~/.pixelagents/config.json
npx pixelagents doctor                # what is installed, what is configured, are events arriving
```

Installing it once (`npm i -g pixelagents`) gives you the `pixelagents` command used below.
`pixelagents hooks uninstall` removes exactly what `install` added. The hook (`bin/emit.js`) has no
dependencies, never blocks Claude Code (always exits 0) and only sends tool names, short commands, paths
and numbers: never prompts, answers, file contents or tool output.

### Run it as a service

```bash
pixelagents service print serve       # shows the launchd / systemd unit
pixelagents service install serve     # installs it for your user
pixelagents service uninstall serve
```

## Several accounts

Each Claude Code account has its own config folder. Install the hooks in each one and name the account;
the name becomes the `account` label, which the default rules turn into a skin.

```bash
pixelagents hooks install --config-dir ~/.claude          --account personal
pixelagents hooks install --config-dir ~/.claude-work     --account work
pixelagents hooks status
```

## Several machines

One machine runs the server (the hub); the others forward their events to it.

On the hub, set a token in `~/.pixelagents/config.json` and listen on the network:

```json
{ "server": { "host": "0.0.0.0", "port": 4242, "token": "change-me" } }
```

A non-loopback host refuses ingest and config changes without a token. Put it behind TLS if it is
reachable from outside your network.

On `laptop` and `workstation`, install the hooks as above and run the forwarder (it reads the local
events and posts them to the hub, surviving restarts and network drops):

```bash
pixelagents agent --hub http://hub.local:4242 --token change-me
pixelagents service install agent --hub http://hub.local:4242 --token change-me   # keep it running
```

Each machine appears as its own office (`laptop`, `workstation`, ...).

## Federation

A server can also read another server as a source, so several hubs can feed one town. Add an input of
type `hub` to the config:

```json
{ "inputs": [ { "id": "work-hub", "type": "hub", "url": "https://hub.work.example", "token": "..." } ] }
```

## Docker

```bash
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build          # http://localhost:4242
```

The image installs the same npm package. Config, state and uploaded sprites live in the `/data` volume;
the file `docker-compose.example.yml` explains how to set the token and mount a local events folder.

## Configuration

Everything is one JSON file (`~/.pixelagents/config.json`, or `--config FILE`): inputs, plugins,
classification rules, offices, behaviors, skins, world, effects. The web UI edits the same file and
reloads it live. Run `pixelagents serve --help` for the flags.

## Commands

| command | what it does |
| --- | --- |
| `pixelagents serve` | server and web app |
| `pixelagents demo` | sample session on a loop, in a temporary folder |
| `pixelagents doctor` | checks node, hooks per config folder, port, sources and whether events arrive |
| `pixelagents hooks install\|uninstall\|status` | manage the Claude Code hooks (`--config-dir`, `--account`) |
| `pixelagents agent` | forward this machine's events to a hub (`--hub`, `--token`) |
| `pixelagents service install\|uninstall\|print` | run `serve` or `agent` at login |

More in [`docs/`](docs/) (architecture, plugins, sources) and [`AGENTS.md`](AGENTS.md).

## Development

```bash
npm install
npm run check                         # typecheck + tests
npm run build                         # all packages, including the publishable one in packages/cli
node scripts/smoke-pack.mjs           # npm pack + install in a temp prefix + `pixelagents demo`
npx playwright test                   # e2e against the packaged server (needs Chrome, or CI's Chromium)
```

MIT. Started from [pixelagents](https://github.com/YehudaLevi/pixelagents) by Yehuda Levi.
