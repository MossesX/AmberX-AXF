# control-registry@1: one index of everything controllable

Build full-api-cli-control-of-everything-plus-an-offli (Brett, Nov 10 2026): "I need extensive API and CLI control over
every single page, app, plugin, tool, behavior, display, and setting with every single option or possibility for a
parameter. Need to be able to completely run the console, Molly, axHub, Hostinger, Coolify, VPS, Moshi app, AmberX app.
I need a powerful complete index and registry for offline management and internal logic. Anything that can possibly be
done without AI needs to be, with AI only as a fallback by default unless you have made Claude available to the console
in Claude settings."

Schema: `contracts/control-registry@1.schema.json`. Engine (pure, the reference): `framework/core/engines/control-registry.mjs`.
Collectors, store and dispatcher (Node, reads the repo): `apps/console-web/lib/registry/`. Check: `node framework/spec/check-control-registry.mjs`.
The offline index: `_claude/builds/registry/index.json` (`node apps/console-web/lib/registry/index.mjs build`).

## What it is

One **entry** per controllable thing, whatever it is and wherever it lives, with the same fields every time:

| Field | Meaning |
|---|---|
| `id` | `<owner>/<type>/<name>[/<sub>]`: `console-web/page/plan-studio`, `console-web/setting/axf.display.fontScale`, `console-web/plugin/follow-amber`, `console-web/tool/follow-amber/show`, `console-web/display/tokens.theme`, `amberx-droid/page/tasks`, `vps/tool/systemd`. Owner and type lower case; the name keeps the thing's own case (a setting key); the type segment is the entry's `type` |
| `type` | `page` (screen, dialog, settings tab) · `app` (a whole app or provider) · `plugin` · `tool` (one command, route, MCP tool, CLI command) · `behavior` (how something behaves) · `display` (how something looks) · `setting` (one key with a value) |
| `owner` | who it belongs to: `console-web`, `molly`, `axhub-web`, `amberx-droid`, `vps`, `hostinger`, `coolify`, `moshi`, … (`owners[]` describes each: kind, how it is reached, its base address) |
| `where` | where it lives: `app`, `plugin`, `view`, `settingsTab`, `dialog`, `menu`, `route`, `file`, `host` |
| `open` | how to put it on screen: `kind` + `target` (exactly what `console_open` / `console_show` take) and `deepLink` (deep-link@1 `?axf-view=…`, or an Android intent URI) |
| `state` | how its state is read without the UI: `read` (a ref), `shape`, `fields[]` (typed; a setting has one field `value` with its allowed values) |
| `actions[]` | everything it can do, each with `id`, `effect` (read · navigate · write · destructive · person), `run` (a ref), `params[]`, `needsAI`, `confirm`, `permission`, `aliases`, `phrases`, `surfaces`, `gaps` |
| `params[]` | every parameter: `name`, `type`, `required`, `default`, and **every allowed value**: `enum` (exhaustive) or `min` / `max` / `step`, `pattern`, `maxLength`, `of` (which records an id names), `enumLabels` (the words for each value), `position` (where it sits in a CLI call or phrase), `aliases` |
| `needsAI` | true only when it cannot be done deterministically. Default false. The dispatcher runs a needsAI action only when Claude settings' **Make Claude available to the console** is on |
| `surfaces` | how it is reached on each surface: `rest`, `mcp`, `cli` (a string = the exact way in; `true` = through the generic dispatcher; `false` = a gap), `voice` (phrases or `false`), `deepLink` |
| `aliases` / `synonyms` / `keywords` | other exact names · words a person uses · search words. The resolver uses them as whole words, never fuzzily |
| `source` | where the entry came from: `plugin-manifest`, `ui-api`, `control`, `voice`, `declared`, `runtime`, `provider` (+ file, frame) |
| `gaps[]` | what is not controllable yet and why (`what`, `why`, `plan`) |
| `hash` | FNV-1a 64-bit of the entry (without `hash` and `source.file`): change detection |

**Refs** say how something runs or is read, in one grammar everywhere (ui-api@1's, extended):
`<plugin>/<command>` · `view:<id>` · `dialog:<id>` · `settings:<tab>` · `action:<console action[:args]>` · `value:<setting key>` ·
`control:<target>/<op>[/<verb>][/<path>]` · `rest:<METHOD> <path>` · `mcp:<tool>` · `cli:<command>` · `intent:<uri>` · `url:<address>` ·
`provider:<axhub connection>/<op>` · `channel:<amberx channel op>` · `element:<where>/<role>:<label>` · `none`.

The **index** (`control-registry@1`): `version`, `generatedAt`, `source` (commit, collectors), `hash` (over every entry's
hash, in id order), `counts`, `owners[]`, `gaps[]`, `entries[]`. Two indexes with the same `hash` hold the same
controllable things; `diff(a, b)` lists added, removed and changed ids. Export = the index file itself (plus a
`exportedAt`); import validates against the schema and the hash before anything is loaded. **No AI runs anywhere in the
index path**: collecting, validating, querying, exporting and importing are plain code.

## Where entries come from (collectors, in order; later ones merge into earlier ones by id)

1. **control@1 targets** (`framework/core/engines/control-rules.mjs`): every token set is a `display` entry (`console-web/display/tokens.theme`)
   whose `set` action's `path` parameter enumerates the token ids and whose `value` carries the field's type and enum;
   every entity target is a `tool` entry whose acts become actions with their declared inputs; the console domain's
   targets are the open/run/back actions every page entry points at.
2. **plugin manifests** (plugin@1, every app's plugins): `provides` → a `page` entry per `view:`, `dialog:` and
   `settings-tab:`, a `plugin` entry per plugin (actions enable / disable / open settings), a `tool` entry per
   plugin-commands@1 command and read (its input schema → params); `lifecycle.dataDir` → the data reads.
3. **ui-api@1 declarations** (plugin.json `ui`, build ui-api-parity-rule): a view's `state` refs become the page entry's
   `state.read`; its `actions` map (control label → ref) becomes actions on the page entry; `uiOnly` becomes gaps.
   This block is read as it is; nothing in it changes.
4. **voice** (voice-intents@1 `voice` block in plugin.json, and AmberX `registerVoiceCommands` calls scanned from
   `apps/amberx-droid/src/plugins/*/web`): phrases land on the entry and action they name, `surfaces.voice` fills in;
   an intent that names no entry yet becomes a `tool` entry with `run` = its action ref.
5. **declared** (control-registry@1 `control` block in plugin.json, `_claude/builds/registry/registry.d/*.json`):
   partial entries by hand: allowed values a scanner can't see, `needsAI`, synonyms, a provider (`owner`), gaps,
   `remove: true` for a derived entry that is not controllable.

A running console can add `runtime` entries (console-catalog@1: what it reports it has) on top, for things the files
don't declare; they are marked so and never written to the committed index.

## Surfaces: all four, the same

Every entry's every action is reachable through the generic dispatcher on each surface (Opus steps s4-s6 wire them):
REST `GET /api/registry`, `GET /api/registry/<id>`, `GET /api/control/<id>/state`, `POST /api/control/<id>/<action>`,
`POST /api/control/resolve`; MCP `registry_list`, `registry_get`, `registry_search`, `control_state`, `control_invoke`,
`control_resolve`; CLI `axf ctl list | get | search | state | set | do | open | resolve | export`; voice through the
resolver in AmberX. When a thing already has its own way in (a plugin tool `follow-amber_show`, `console_open`,
`axf follow-amber show`), `surfaces` names it, so the generic path and the native one are the same call.

## The dispatcher (deterministic first, AI only as a gated fallback)

`resolve(index, input)` takes a command (`{ id, action, params }`), a CLI call (`['follow-amber', 'show', '--target', 'plan-studio']`)
or a phrase (`"open plan studio"`) and answers one of:

- `{ ok: true, entry, action, params }`: an exact match. Exact means: the entry id, an alias, the open target, the
  voice command id, or a label / synonym matched as whole words; the action by id, alias or phrase; every parameter
  checked against its type and allowed values (`enum`, `enumLabels`, `min` / `max` / `step`, `pattern`), defaults
  filled, unknown parameters refused. Nothing fuzzy, no model.
- `{ ok: false, code: 'ambiguous', candidates }`: several entries match equally well; the caller picks.
- `{ ok: false, code: 'validation', errors, entry, action }`: the thing was found but a parameter is wrong; `errors`
  say which and list the allowed values.
- `{ ok: false, code: 'not_found', candidates, gap }`: nothing matches. `candidates` = the closest registry entries
  (whole-word hits on label, synonyms, keywords); `gap` = what would have to be declared for this to resolve.
- `{ ok: false, code: 'needs_ai', entry, action, ai }`: the match needs a model (`needsAI`), and whether the gate is open.

The **AI gate** (`apps/console-web/lib/registry/ai-fallback.mjs`): Claude is asked only when `resolve` answered
`not_found` or `needs_ai` **and** Claude settings' `console.claudeAvailable` ("Make Claude available to the console",
owner-only, default off) is on. Otherwise the answer is the deterministic one, with the closest matches and the gap, and
`ai: { available: false, why }` so the caller can tell Brett in one line. The gate reads the setting through the plugin
that provides `service:axf.claude-settings@1` (never by folder name); `AXF_CLAUDE_AVAILABLE=1|0` overrides it in tests
and offline. When the gate is open the fallback hands Claude the phrase and the closest candidates and expects back a
`{ id, action, params }` that is then resolved deterministically again: a model proposes, the registry decides.

## Migration: existing declarations keep working

Nothing is replaced. Each existing declaration is read where it is and becomes part of the index:

| Existing | Stays as | Becomes in the index |
|---|---|---|
| plugin@1 `provides` (`view:`, `dialog:`, `settings-tab:`, `action:`) | unchanged | `page` entries with `open` filled from the id (`console_open` target, deep-link@1 URL) |
| plugin-commands@1 `commands` | unchanged | `tool` entries (`<owner>/tool/<plugin>/<command>`); `input` → `params` (JSON Schema `type` / `enum` / `minimum` / `maximum` / `default` / `required`) |
| ui-api@1 `ui` (PR #393, ui-api-parity-rule) | unchanged; its ref grammar is a subset of this one | the page entry's `state.read` and `actions`; `uiOnly` → `gaps` |
| control@1 targets | unchanged | `display` / `tool` entries; `fields` → `params` with enums |
| console-catalog@1 (a running console) | unchanged | `runtime` entries, never committed |
| AmberX `registerVoiceCommands` (code) | unchanged; declare the same phrases in `voice` to have them offline | `surfaces.voice` and action `phrases` |

What a plugin **may add**, both optional, both checked by `plugin-lifecycle.mjs check` once the Opus steps land:

```json
"control": { "$axf": "control-registry@1", "entries": [
  { "id": "console-web/tool/follow-amber/show", "actions": [ { "id": "run", "params": [
    { "name": "to", "type": "enum", "enum": ["recent", "all"], "default": "recent", "description": "which open console" } ] } ] },
  { "id": "console-web/page/follow-amber", "synonyms": ["follow", "follow me"] }
] },
"voice": { "$axf": "voice-intents@1", "intents": [
  { "id": "follow-amber.on", "phrases": ["follow me", "turn follow amber on"], "entry": "console-web/tool/follow-amber/switch", "action": "run", "params": { "on": true } }
] }
```

A parameter without allowed values is a **gap** (`what: "params"`), listed on the entry and in the index's `gaps`, so
the coverage checker (step s16) can fail CI on it. The id grammar is fixed: a plugin's entries are
`<app>/<type>/<name>` where `<app>` is the app the plugin runs in; a plugin never names another plugin's folder in its
declarations except as the `<name>` of its own tool entries.

## Kotlin twin

Deferred (Android on hold): framework/spec/PORTING.md lists the engine. AmberX's voice resolver (`voice/web/core.ts`
`pickCommand`) and this resolver agree on normalisation (`foldWords` = `normalize`) so a phrase means the same on the phone
and in the console.
