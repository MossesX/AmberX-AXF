<!-- memory-chunk@1 source=_claude/memory/docs/plan-studio/README.md lines=9-39 tokens=807 -->
## What's in it

| Part | Where |
| --- | --- |
| Contract `plan@1` (JSON + Markdown body) | `web/plan-core.mjs` (normalize/migrate/validate, categories, totals, diff, versions, templates, Markdown, build link, catalog overlay), `schema/plan.schema.json`, `fixtures/cases.json` → `fixtures/plan.json` |
| Migrations | plan@0 drafts (`name/description/state/tasks`), pending@1 items (`subPrompts` → steps), loose notes; unknown fields kept |
| Store + CLI | `plans.mjs` (`add | list | show [--md] | status | import | export | ai | categories | catalog | sync-builds | api`), one file per plan |
| Catalog discovery | `catalog.mjs`: builtPlugins + plugins.json, every `apps/*` with a project manifest, libraries.json + framework/libs, tracker modules, axHub; gone = seen before, missing now |
| Server | `server/__init__.py`: `state`, `api`, `catalog`, `ai/status`, `ai`; capability **`plans@1`** (`list/get/save/park/ai`) |
| Web | `ui.tsx` (Plans · Catalog · Categories; tree, grid, sub-grids, board with drag, roadmap, reader; search every field, filters, sort, saved views, counts, bulk), `editor.tsx` (sectioned editor), `catalog.tsx`, `capture.tsx` (quick capture), `ai.tsx` (command box + voice panel), `voice.ts` |
| AI | `web/plan-ai.mjs`: rules for common phrasings, the console's `axf.llm@1` for the rest; edits shown as a diff (Apply / Discard), optional apply-at-once with Undo; history note `AI, from: <what was said>` |
| Voice | `web/voice.ts`: turn loop until "I'm done", "undo that", "say that again", yes/no confirm for big edits and Turn into a build; mic through **mic-lease@1** (`globalThis.__axfMicLease`), listening via AmberX native speech else Web Speech; replies via **agent-voice@1** (`axf:agent-voice.say`) when installed, else AmberX native speak / Web Speech |

Where plans live: the hub's shared data `/projects/amberx-axf/_data/plan-studio/` (`plans/<id>.json`,
`history/<id>.json`, `categories.json`, `templates.json`, `views.json`, `catalog-seen.json`). claude.ai sessions:
`axhub.memory_read` / `memory_write`, project `amberx-axf`, area `data`, path `plan-studio/plans/<id>.json`. Off the hub
it's the plugin data folder `.axf-console/plugins/plan-studio/`. <!-- axf-plugin:plan-studio -->

Quick capture: banner **+ Plan**, Builds ▸ New plan…, right-click ▸ New plan…, the global search ("New plan").

Turn into a build: preview the steps (dependency order, model, estimate), then the plan's build is written into the
chosen profile's orchestrator tracker (orchestrator@1 file through `persist.mjs orchestratorPath`, never the
orchestrator plugin's folder); the build carries a note naming the plan, the plan carries `build` + a build link. Every
state load syncs progress: the plan's steps tick as the build's do, and when the build completes the plan is done and its
planned features become have.

Catalog features are read, not copied: plugin.json `provides`/`features`/`targets`, app plugins, tracker items (by
module), and the feature matrix items of a plan's build. Plans add planned features on top. Planned tracker items are
written back through the tracker's path (`framework/catalog/status.json` gets `plan: <id>`, `status: built` once the
plan is done; `tracker.mjs` regenerates).
