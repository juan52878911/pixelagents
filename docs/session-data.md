# Datos de sesión: qué se extrae, de dónde y qué muestra

Inventario de todo lo que pixelagents saca de una sesión de Claude Code sin leer texto. Regla de
privacidad (AGENTS.md): nunca prompts, respuestas, contenido de ficheros, salidas de herramientas,
mensajes de error ni valores de entorno. Solo identificadores, nombres de herramienta, rutas o
comandos cortos (≤120 caracteres), enumeraciones y números. Los fixtures llevan cadenas `SECRET` en
cada campo prohibido y los tests comprueban que ningún evento las contiene.

## Fuentes

| Fuente | Dónde | Quién la lee |
|---|---|---|
| Hooks de Claude Code | stdin de `packages/emitter/bin/emit.js` (JSON del hook) | el emisor → `~/.pixelagents/events.jsonl` (`HookLine` v1) → adaptador `claude-code` |
| Transcript de la sesión | `~/.claude/projects/<proyecto>/<sesión>.jsonl` (`transcript_path` del hook) | el emisor, solo en `Stop` y `SubagentStop`: últimos 256 KB, de atrás hacia delante hasta el prompt que abrió el turno |
| nod | `~/.local/state/nod/events.jsonl` (sobres `{nod, source, events[]}`) | adaptador `nod` (`plugins/nod`) |

## Hooks → `HookLine` → `PaEvent`

| Hook | Campos leídos | `HookLine` | `PaEvent.kind` / attrs / labels | Qué muestra |
|---|---|---|---|---|
| todos | `session_id`, `cwd`, `permission_mode`, `effort.level`, `agent_type`, `hook_event_name` | `session`, `cwd`, `repo`/`branch` (del `.git` de `cwd`), `permissionMode`, `effort`, `agentType` | labels `permission_mode`, `effort`, `agent_type`; attrs `effort` en `turn.end` | inspector: permisos, nivel de esfuerzo, tipo de subagente |
| `SessionStart` | `source` (startup/resume/clear/compact/fork), `model` | `source`, `model` | `session.start` {model, source} | entidad aparece; historial «session started (resume)» |
| `UserPromptSubmit` | nada (el `prompt` no se lee) | — | `turn.start` | estado *pensando*; abre `entity.turn` |
| `PreToolUse` | `tool_name`, `tool_input.{file_path,pattern,path,command,query,url}` (primera línea, ≤120) | `tool`, `detail` | `tool.pre` {tool, detail} | estado *trabajando*, icono de categoría, intensidad |
| `PostToolUse` | `tool_name`, mismo detalle, `duration_ms` | `tool`, `detail`, `durationMs` | `tool.post` {tool, detail, duration_ms} | cierra una espera de permiso |
| `PostToolUseFailure` | `tool_name`, detalle, `duration_ms`, `is_interrupt`, `error` (solo `^Exit code N`) | `ok:false`, `error` = `exit N` / `interrupt` / `error` | `tool.post` {ok:false, error} | burbuja ✗ roja, `errors`, `error_streak`, historial «Bash failed (exit 1)» |
| `Notification` | `notification_type` (permission_prompt → espera de permiso; idle_prompt, agent_needs_input, elicitation_* → espera humana; otros se descartan). Sin tipo: `/permission/i` sobre `message` | kind | `waiting.permission` / `waiting.human` | burbuja «!», chip de espera, «esperando desde hace…» |
| `SubagentStart` | `agent_id`, `agent_type` | `parent`, `session=<sesión>:<id>`, `agentType` | `fork.start` {agent_type} sobre `subagent:<sesión>:<id>` con `parent` | mini junto al padre; el padre se levanta y entrega (burbuja portapapeles) |
| `SubagentStop` | `agent_id`, `agent_type`, `agent_transcript_path` (solo números de uso) | + `usage`, `steps`, `contextTokens`, `usageModel`, `turnMs` | `fork.end` {usage, steps, context_tokens, duration_ms, model} | poof del mini; el padre recibe (burbuja ✓); tokens/coste del subagente |
| `Stop` | `transcript_path` (solo números de uso del último turno) | `usage`, `steps`, `contextTokens`, `usageModel`, `turnMs` | `turn.end` {usage, steps, context_tokens, duration_ms, model, effort} | estado *inactivo*; cierra el turno: duración, herramientas, tokens, coste estimado |
| `PreCompact` | `trigger` (auto/manual) | `kind: compact`, `source` | `compact` {trigger} | burbuja de caja comprimida; `compactions`; historial «context compacted (auto)» |
| `SessionEnd` | `reason` | `reason` | `session.end` {reason} | el agente se va; historial «session ended (prompt_input_exit)» |
| otros hooks | solo el nombre | `kind: other`, `tool: <hook>` | descartado por el adaptador | — |

Campos que existen en los hooks y **no se leen**: `prompt`, `tool_input.content|old_string|new_string`,
`tool_response`, `error` (más allá del código de salida), `message`/`title`, `last_assistant_message`,
`custom_instructions`, `compact_summary`, `transcript_path` como texto.

## Transcript (solo en `Stop` / `SubagentStop`)

Cada línea es un JSON con `type` (`user`, `assistant`, `system`), `timestamp`, `message` y metadatos.
El emisor recorre la cola del fichero hacia atrás y se detiene en el primer mensaje `user` que no sea
un `tool_result` (el prompt que abrió el turno). De cada línea `assistant` lee:

| Campo | Qué da | Dónde acaba |
|---|---|---|
| `message.usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` | tokens del turno (suma de pasos) | `usage.{input,output,cache_read,cache_write}` → métricas `tokens_*`, `turn_tokens_*` |
| último paso: `input + cache_read + cache_write` | tamaño del contexto | `contextTokens` → métrica `context_tokens` |
| `message.model` | modelo real del turno | `usageModel` → label `model`, precio del coste estimado |
| nº de líneas `assistant` | pasos del turno | `steps` → `turn_steps` |
| `timestamp` del primer y último paso | duración del turno | `turnMs` → `turn_ms` |

Si el turno no cabe en los 256 KB leídos, la suma es parcial (se queda con lo que ve). Coste: el
reductor del plugin `claude-code` multiplica el uso por una tabla de precios por familia de modelo
(`plugins/claude-code/src/reducer.ts`, `PRICES`) y acumula `cost_est_usd` (≈ en el inspector), que
nunca pisa `cost_usd` cuando lo aporta una fuente que lo conoce (nod).

Campos del transcript que **no se leen**: `message.content` (texto, thinking, tool_use.input,
tool_result), `toolUseResult`, `summary`, `compactMetadata`, `error` de `api_error`,
`last_assistant_message`.

## nod

| Evento nod | Campos leídos | `PaEvent` | Qué muestra |
|---|---|---|---|
| `session.start` | `data.model`, `data.repo.{root,branch}`; `source.profile`, `source.machine` | `session.start` {model, source:startup}; labels account/host/repo/branch/model | entidad, oficina por repo |
| `session.end` | `data.reason` | `session.end` {reason} | salida |
| `turn.start` | — | `turn.start` | turno abierto |
| `turn.step` | `data.effort` (se guarda y se adjunta al `turn.end` de la misma sesión) | — | nivel de esfuerzo |
| `turn.end` | `data.usage.{input,output,cache_read,cache_write,model}`, `duration_ms`, `steps`, `outcome` | `turn.end` {usage, duration_ms, steps, outcome, model, effort} | duración, tokens, pasos |
| `tool.call` | `data.tool` | `tool.pre` {tool} | trabajando |
| `tool.result` | `data.tool`, `ok`, `rejected`, `duration_ms` | `tool.post` {tool, ok, error:'rejected'?, duration_ms} | errores |
| `permission.request` | `data.tool` | `waiting.permission` {tool} | espera |
| `permission.decision` | `data.wait_ms`, `data.decision` | `state` {status:working, wait_ms, reason} | tiempo de espera medido por la fuente |
| `agent.spawn` | `data.agent`, `type`, `model` | `fork.start` {agent_type, model} en `subagent:<sesión>-<agent>` | mini + traspaso |
| `agent.end` | `data.agent`, `duration_ms`, `usage` | `fork.end` {usage, duration_ms, model} | resultado recibido |
| `usage` | `cost_usd`, `context.percent`, `limits[].percent` | `metric` {cost_usd, context_pct, limit_5h_pct, limit_7d_pct} | coste real, contexto %, límites |

No se leen: `prompt.submit.text`, `turn.end.answer`, `tool.call.input`, `job.*.text`.

## Modelo de estado derivado (`packages/server/src/reducer.ts`)

`Entity.turn` (`TurnState`): `since`, `until` (cuando acaba), `n` (ordinal; 0 si la fuente no tiene
turnos y se abrió uno implícito con la primera herramienta), `tools`, `errors`, `forks`, `lastToolAt`.

Métricas (todas numéricas, en `entity.metrics`):

| Métrica | Cálculo | Dónde se ve |
|---|---|---|
| `turns`, `tools`, `errors`, `error_streak`, `compactions`, `forks`, `waits` | contadores por evento | inspector «Sesión → totales» |
| `turn_ms`, `turn_tools`, `turn_steps`, `turn_tokens_in`, `turn_tokens_out` | del último turno cerrado (`duration_ms` de la fuente o reloj) | inspector «Último turno» |
| `tokens_in`, `tokens_out`, `tokens_cache_read`, `tokens_cache_write`, `context_tokens` | acumulado de `usage` | inspector «Sesión → tokens/contexto» |
| `cost_est_usd`, `cost_turn_usd` | plugin claude-code, tabla de precios | coste ≈ (si no hay `cost_usd`) |
| `wait_ms_last`, `wait_ms_total` | reloj entre `waiting.*` y lo que lo cierra (`tool.pre`, `tool.post`, `turn.end`, `state`), o `wait_ms` de la fuente | inspector «esperas» |
| `subagents_live` | hijos con `parent` = esta entidad y estado ≠ ended (lo mantiene el store al reducir `fork.*`) | título «Subagentes · N vivos» |
| `tools_per_min`, `intensity` (0..100) | media exponencial del ritmo de herramientas; 12 herr./min = 100; decae 4 puntos/s tras 20 s sin herramientas o cuando no está trabajando | sudor (≥45), chispas (≥80), medidor del inspector |

## Escena (`packages/web/src/scene/social.ts`, `behaviors.ts`)

- Burbujas de icono (pixel 7×7) por evento: ✗ rojo (herramienta fallida), caja comprimida
  (compactación), portapapeles (lanza subagente), ✓ verde (recibe el resultado), mano (pide al
  humano), bandera (turno terminado). Sustituyen a la burbuja de estado mientras duran.
- Traspasos: al lanzar o terminar un subagente, el padre se levanta 1,8 s delante de su mesa, donde
  están sus minis, con la burbuja correspondiente, y vuelve a sentarse.
- Charlas: al elegir con quién charla un agente inactivo, se prefieren los compañeros del mismo repo.
- Esfuerzo: gotas de sudor junto a la cabeza desde intensidad 45, chispas alrededor desde 80.
