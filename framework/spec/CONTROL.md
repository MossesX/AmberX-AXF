# CONTROL — control@1, one command for every token, every AmberX entity and the planner

Status: contract since Nov 3 2026 (Urgent build `token-control` s3, Fable). Reference: `framework/core/engines/control-rules.mjs`
(pure; shared by the TS engines, the build engine, the console server's MCP + API and the CLI). Snapshot: `framework/schemas/control.json`
(the registry, tools, routes, CLI usage and JSON Schema; `check-control.mts` keeps it equal). Fixture: `framework/spec/fixtures/control.json`.
Transports (the Opus phase of the same build): the console's REST routes under `/api/control`, the MCP tools `control_*` on the console's
`/mcp` and through axHub, the CLI `axf control …` with the aliases `axf token | note | todo | task | list | plan | build …`, and the shared
JS client. Kotlin twin deferred (Android on hold); the Python mirror lands with the MCP server.

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
| `target` | `tokens.theme` · `tokens.style` · `tokens.layout` · `tokens.typography` · `tokens.density` · `tokens.sizing` · `tokens.look` · `tokens.custom` · `tokens.slots` · `amberx.items` · `amberx.lists` · `planner.plans` · `planner.builds` |
| `path` | the token id (`navWidth`, `accent`, `scale.md`, `button.radius@amber`) or the record id; `get`/`set`/`remove`/`act` need it, `reset` without one resets the whole target |
| `value` | what to set (a token value, or the fields to change on a record) · the new record for `add` |
| `action` + `input` | the verb for `act` and what it wants (`done`, `move {list}`, `approve {phase}`, `step {step, done}` …) |
| `select` | filters for `list` (per target: `kind`, `status`, `tag`, `q`, `profile` …) |
| `confirm` | the confirm token a `remove` sends on its second call |
| `by`, `reason` | who and why; audited on every write |

Effects: `list`/`get` read · `set`/`reset`/`add`/`act` write · `remove` destructive. The MCP tool annotations (`readOnlyHint`,
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

## Auth

Permissions: `control.<domain>.read | write | delete` (`control.tokens.write`, `control.amberx.delete`, …), declared in an app's
uac-policy; `control.*`, `control.<domain>.*` and `*` are wildcards (the UAC engine's own rule). The console token = the admin role;
a call through axHub carries the hub user's role; a remote caller never exceeds the app's own UAC role (INTEROP.md). The gate, in order:

1. the target exists (`not_found`) and takes the op (`invalid`);
2. the caller's grants cover the permission (`denied`, naming it);
3. the command validates (`validation`, every problem named: unknown token, value out of range, missing input, bad filter);
4. a destructive op carries a valid confirm token (else `confirmation_required` with the token).

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
