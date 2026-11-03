# CONTROL — control@1, one command for every token, every AmberX entity and the planner

Status: contract since Nov 3 2026 (Urgent build `token-control` s3, Fable). Reference: `framework/core/engines/control-rules.mjs`
(pure; shared by the TS engines, the build engine, the console server's MCP + API and the CLI). Snapshot: `framework/schemas/control.json`
(the registry, tools, routes, CLI usage and JSON Schema; `check-control.mts` keeps it equal). Fixture: `framework/spec/fixtures/control.json`.
Transports (the Opus phase of the same build): the console's REST routes under `/api/control`, the MCP tools `control_*` on the console's
`/mcp` and through axHub, the CLI `axf control …` with the aliases `axf token | note | todo | task | list | plan | build …`, and the shared
JS client. Kotlin twin deferred (Android on hold). The transports run one Node runner (no Python mirror needed): the
Token control plugin (`apps/console-web/plugins/token-control`, capability `control@1`, Nov 3 2026) — `control.mjs`
(runner + CLI), `server/__init__.py` (REST; main.py mounts it at `/api/control`), the console MCP's `control_*` tools
(`mcp_server.py` → the capability), `web/client.mjs` (shared client). Token sets write `axf.tokens.<set>` overrides into
the appearance document (`core/engines/control-tokens.mjs`); the runtime applies them in `compileStyles`.

## Why one schema

Brett (Nov 2 2026): "a powerful API, MCP and CLI server/client that can change every single token (theme, style, layout); every layout
parameter is a token … control every aspect of AmberX tasks, to-dos and notes, and the console planner (Plan Studio and the Build
orchestrator)". Three surfaces, one grammar: a transport only carries a command and an answer; what a command may do, who may do it,
what it needs, and what it answers are decided here once, so the docs, the tools, the routes and the CLI never disagree.

## The command

```json
{ "$axf": "control@1", "op": "set", "target": "tokens.layout", "path": "navWidth", "value": 200, "by": "claude", "reason": "narrower rail" }
```

| Field | Meaning |
|---|---|
| `op` | `list` · `get` · `set` · `reset` · `add` · `remove` · `act` |
| `target` | `tokens.theme` · `tokens.style` · `tokens.layout` · `tokens.typography` · `tokens.density` · `tokens.sizing` · `tokens.look` · `tokens.custom` · `tokens.slots` · `amberx.items` · `amberx.lists` · `planner.plans` · `planner.builds` · `console.screens` · `console.dialogs` · `console.settings` · `console.actions` · `console.nav` · `console.clients` · `plugins.commands` · `plugins.reads` |
| `path` | the token id (`navWidth`, `accent`, `scale.md`, `button.radius@amber`) or the record id; `get`/`set`/`remove`/`act` need it, `reset` without one resets the whole target |
| `value` | what to set (a token value, or the fields to change on a record) · the new record for `add` |
| `action` + `input` | the verb for `act` and what it wants (`done`, `move {list}`, `approve {phase}`, `step {step, done}` …) |
| `select` | filters for `list` (per target: `kind`, `status`, `tag`, `q`, `profile` …) |
| `confirm` | the confirm token a `remove` sends on its second call |
| `by`, `reason` | who and why; audited on every write |

Effects: `list`/`get` read · `set`/`reset`/`add`/`act` write · `remove` destructive · a target's `actEffect` may make a verb
`navigate` (console `open`, `back`, `home`, `close`: changes what a screen shows, no data). The MCP tool annotations (`readOnlyHint`,
`destructiveHint`) and the permission a call needs come from the effect.

## Targets

**Tokens** (`tokens.*`): a `set` is an override on top of the active asset, stored per asset id and shared through the axHub look
(Nov 1 2026 rule: any look change applies to every app); `reset` drops it; `list` names every token with its kind, unit, default
and range. The static targets (theme, style, layout, typography, density, sizing) are listed by the registry itself; `look`,
`custom` and `slots` are listed by the running app (look@1 ids, asset-customize@1 tokens, the appearance slot types).
`tokens.slots` set = `runtime.swap(type, id)`, the hot-swap.

**AmberX** (`amberx.items`, `amberx.lists`): amberx-notes@1 records (apps/amberx-droid notes core; one store for notes, to-dos and
tasks on every device). Fields, filters and verbs are the notes core's own (`done`, `move`, `merge`, `pin`, `star`, `check` on items;
`move`, `reorder`, `rename` on lists). System lists (`inbox`, `plugins`, `voice-notes`) can't be removed.

**Planner** (`planner.plans`, `planner.builds`): plan@1 plans (Plan Studio) and builds@1 records through the orchestrator (the one
builds store; every write journalled). Verbs are the orchestrator's own actions (`step`, `approve`, `status`, `note`, `rename`,
`rename-step`, `add-step`, `edit-step`, `skip-step`, `remove-step`, `move-step`, `archive`, `hide`, `unhide`) and Plan Studio's
(`park`, `build`, `restore`, `export`, `step`, `comment`).

**Console** (`console.*`, build console-commands, Nov 3 2026): Brett tells a Claude session "open Plan Studio" and his open console
goes there. `console.screens`, `console.dialogs` and `console.settings` (tabs and sub-tabs, `plugins/<id>`) take `act open` with
`path` = the id, the title or words to search for; `console.actions` takes `act run` (input `args`); `console.nav` (path `here`)
takes `get` (where the console is) and `act back | home | close`; `console.clients` lists the consoles open for the caller. Every
list and resolve runs against the catalog the open consoles report (their search index: views, settings tabs, dialogs, actions),
so plugins' screens are found too. Every act takes `input.to`: `recent` (default, the console used last), `all`, or a client id.
Delivery and resolution: `core/engines/console-commands.mjs`; the console server's `console-commands` plugin keeps one mailbox
per signed-in user (the console token and hub admins share the owner's) and streams to each open console, which runs the command
through its own runtime (`rt.search.focus`, `rt.dispatch`) and acks what it opened.

**Plugins** (`plugins.commands`, `plugins.reads`, build plugin-commands-auto, Nov 3 2026, Brett: "every plugin, existing and
new, automatically exposes all of its commands and reads"): one registry (`core/engines/plugin-commands.mjs`, plugin-commands@1)
made from what every plugin already has — its server routes (GET = a read, POST/PUT/PATCH = a command, DELETE or a deleting word =
destructive), its registered web actions (run in the open console through the Console commands plugin, like `console.actions`),
its data folder (`data`, `data-file`, secrets redacted) and `info` — plus plugin.json `commands` (titles, input schemas, flags,
extra commands, skips that say why). `path` = `<plugin>/<command>`; `plugins.reads` takes `act read`, `plugins.commands` takes
`act run`, both with `input` = what the command takes; `list` filters by `plugin`, `app`, `effect`, `q`. A command that deletes needs
`control.plugins.delete` and a confirm token (the same two-step flow as `remove`). Every transport is generated from the registry
and follows installs and uninstalls by itself: REST `GET|POST|DELETE /api/control/<plugin>/<command>`, MCP tools
`<plugin>_<command>` (annotations from the effect) plus `plugin_commands`, `plugin_read`, `plugin_run`, and the CLI
`axf <plugin> <command> [--field value]…` / `axf plugins [plugin]`. Runner: the Plugin commands plugin
(`apps/console-web/plugins/plugin-commands`, capability `plugin-commands@1`). The lifecycle check fails a plugin whose route or
action can't be exposed, whose declarations name something gone, or that has no reads without saying why (`commands.noReads`).

## Auth

Permissions: `control.<domain>.read | write | delete` (`control.tokens.write`, `control.amberx.delete`, `control.plugins.read`, …), plus
`control.console.navigate` for console verbs that only navigate, declared in an app's
uac-policy; `control.*`, `control.<domain>.*` and `*` are wildcards (the UAC engine's own rule). The console token = the admin role;
a call through axHub carries the hub user's role; a remote caller never exceeds the app's own UAC role (INTEROP.md). The gate, in order:

1. the target exists (`not_found`) and takes the op (`invalid`);
2. the caller's grants cover the permission (`denied`, naming it);
3. the command validates (`validation`, every problem named: unknown token, value out of range, missing input, bad filter);
4. a destructive op carries a valid confirm token (else `confirmation_required` with the token).

Console actions keep their own policy on top: `console.actions run` is gated as `control.console.write`, then the console engine
looks the action up — an action that only navigates (`nav:`, `dialog:`, `settings.open:`, windows, help, search) needs only
`control.console.navigate`; one that `requires` a UAC permission needs it in the caller's grants too; one marked destructive
(`effect: 'destructive'` on the action, or a known destructive id) needs `control.console.delete` and a confirm token, the same
two-step flow as `remove`. The open console then runs it under the signed-in user's own role (`rt.dispatch` checks `requires`).

## Deletes need confirm

`remove` never runs on its first call. The gate answers `confirmation_required` with a **confirm token** bound to the exact command
(op, target, path, action, value: `canonicalControl`) and the server's salt, in ten-minute buckets; the same command sent again with
`confirm: <token>` runs while the token is good (ten to twenty minutes). A different path or value makes a different token, so a
confirm can't be replayed on another record. The CLI prints the token and the exact command to repeat; the MCP tool says so in its
description; the console's docs show the two-step flow.

## Answers

Success: `{ $axf, ok: true, op, target, path?, action?, …data, audit? }` with `data` per op (`list` → `items`, `total`; `get` → `value`
or `item`; `set`/`reset`/`add`/`act` → `changed`, `item?`; `remove` → `removed`); writes carry `audit { by, reason, at }`.
Failure: `{ $axf, ok: false, code, message, … }` with a wire code from INTEROP.md (`invalid`, `denied`, `not_found`, `validation`,
`confirmation_required`, `not_implemented`, `unexpected`); unknown codes read as `unexpected`.

## Projections

- `controlTools()` → the seven MCP tools `control_list … control_act` with input schemas and annotations.
- `controlRoutes()` → REST: `GET /api/control/{target}`, `GET|PUT|DELETE /api/control/{target}/{path}`, `POST …/reset`, `POST …/act/{action}`,
  and `POST /api/control` taking a whole command.
- `controlCli()` → `axf control <op> <target> …` and the aliases.
- `controlSchema()` → the JSON Schema with every target's fields, filters, verbs and static paths under `$defs`.

A new target or verb is added to `CONTROL_TARGETS` (append-only) and every projection, the docs page and the fixture follow.
