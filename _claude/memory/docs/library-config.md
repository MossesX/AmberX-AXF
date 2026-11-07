# library-config@1 / library-instance@1 — the no-code library import wizard

Build `library-harvest` addendum 1 (Brett, Nov 7 2026): "Every harvested library ships a configuration manifest. When a
library is imported (now, and in a future App Designer), a wizard launches … Fully no-code. The result is saved as a
configured instance asset that can be reconfigured or removed later. API/MCP/CLI and voice parity."

## Where

- Engine (pure, Node + browser): `framework/core/library-config.mjs` (+ `.d.mts`). Kotlin twin deferred (`spec/PORTING.md`).
- CLI: `framework/cli/library-config.mjs`. Fixture: `spec/fixtures/library-config.json`. Check: `spec/check-library-config.mts`.
- Snapshots: `schemas/library-config.json`, `schemas/json/library-config.schema.json`, `schemas/json/library-instance.schema.json`
  (rewrite with `npx -y tsx framework/spec/check-library-config.mts --write`).
- Instances: `<app>/library-instances/<id>.json` (not under `src/assets` until `library-instance` is an asset@1 type).

## The manifest is derived

`manifestFrom(libraryJson)` reads a library@1 record:

| library@1 | library-config@1 |
| --- | --- |
| `parts[]` (id, label, default, requires, params) | `capabilities[]` — "what do you want it to do" |
| `params[]` not secret | `settings[]` |
| `params[]` secret (`secret: true` or key ends in token / password / secret / apiKey / credential) | `credentials[]` |
| `config.connections[]` | `connections[]` — inputs / outputs: `dataset`, `registry-ui`, `plugin`, `service`, `action`, `asset`; `in` / `out` / `both`; `required`, `many`, `forCapability` |
| `config.credentials[]` | more `credentials[]` (`env` names the usual variable) |
| `config.wizard` | `wizard.mode` scripted / assisted / both, `wizard.intro` |
| `dependsOn`, `provides`, `ports`, `placeholders` | `dependsOn`, `provides`, `ports`, `notYet` |

So every existing library already has a manifest; a library says more with a `config` block (lib-datagrid is the example).

## Wizard

`wizardSteps(m)` → about → capabilities → connections → settings → credentials → review; steps with no fields are left
out, about and review always stay. Each step has `title`, `ask` (plain words, what a voice or AI assistant says) and
`fields`. `newDraft(m)` starts from the defaults; `answerStep(m, draft, stepId, answers)` applies one step (any surface),
returning the new draft and the errors in words; `draftErrors(m, draft)` is what still blocks apply.

Answers: `capabilities: { id: true | false | { param: value } }`, `connections: { id: "dataset:x" | [...] }`,
`settings: { key: value }`, `credentials: { key: "env:NAME" | "secret:KEY" | "hub:PATH" }`. A credential **value** is
refused with the reason; connection refs must start with the kind's prefix (`dataset:`, `ui:`, `plugin:`, `service:`,
`action:`, `asset:`).

## Instance

`instanceFrom(m, draft, { now, app, id?, by?, surface? })` → library-instance@1: `capabilities[]`, `capabilityParams`,
`params`, `connections { id: { kind, ref } }`, `credentials { key: { ref } }`, `status` configured / disabled / removed,
`history[]`. `draftFromInstance` → `reconfigure` (keeps id, createdAt, history), `setStatus` (nothing is deleted),
`installConfig(m, inst)` → the `libraries.<key>` block the installer writes (`parts` = on capabilities with params, plus
`connections`, `credentials` refs and `instance` id), `instanceSummary` → words for review / cards / voice.

## CLI

```
node framework/cli/library-config.mjs list
node framework/cli/library-config.mjs steps datagrid
node framework/cli/library-config.mjs wizard datagrid --app apps/console-web --set capabilities.expand=false --dry-run
node framework/cli/library-config.mjs wizard hubstore --app apps/molly --answers answers.json
node framework/cli/library-config.mjs instances apps/molly | show apps/molly <id> | reconfigure … | disable | enable | remove | install-config
```

## Still to build (Plan Studio plan "Library harvest")

Console REST + MCP tools (`library_config_list|steps|wizard|instances|reconfigure|remove`) and `library.*` console
actions for voice; the Library browser / App Designer running the same steps; `library-instance` as an asset@1 type
(Fable); Kotlin `LibraryConfig` when Android resumes.
