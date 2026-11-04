# Build to-do sync

A Dev Console plugin. Every build gets a **short name** and a **category**, and a **to-do list** in the AmberX to-do
manager whose items are exactly the orchestrator's steps, ticked off live. Every build also gets a **Plan Studio plan**
kept in sync, with a **Planned & fixes** checklist and a **Docs** section.

Brett, Nov 4 2026: "For every build from now on … prompt me for a name which will be used to reference it in the to-do
manager. Then we're going to add a list in the to-do manager with all the steps that Orchestrator broke it into. And
then it will check off each one in real time as the orchestrator processes each step."

## What it does

- **Name + category on every build.** `displayName` (48 characters at most) and `category` (Plugin, Plugin extension,
  Add-on, Framework, App, Feature, Module) live on the build record (builds@1). Every way a build is made suggests both
  from the title and flags them for review (`nameReview`); Brett confirms or edits them in the **Name this build** prompt
  (opens by itself for a new build, from Builds → Name a build…, or by `console_show dialog:build-todo-sync.name`), on the
  orchestrator card (Edit), or by API / voice. The old free-text category became `area`.
- **One list per build.** `Builds › <Category> › <name>` in the AmberX to-do manager, one item per step in order, with
  model, estimate, phase, agent and a link back in the item text. Done builds move to `Builds › Done` for 7 days,
  cancelled ones to `Builds › Archive`. A pinned note on `Builds` says when the lists were last synced.
- **Live check-off.** Every builds store write posts a `build-todo-sync@1` event (`framework/cli/builds-events.mjs`);
  the plugin syncs within two seconds. A poll of the store file and a full reconcile every 10 minutes catch anything
  missed. Rename, re-category, steps added / removed / reordered / skipped, held (needs approval), blocked, failed and
  handed-to-a-helper all mirror as list moves, item edits and tags.
- **Store = truth.** Ticking or unticking a *step* item in the to-do manager opens an **ask**: Brett approves (the step
  changes in the orchestrator) or denies (the item goes back). Only his own signed-in console answers. Ticking a
  *Planned & fixes* item applies at once (it is his checklist).
- **Plan Studio.** Every mirrored build has a plan (same name, `Builds > <Category>`, verbatim ask, steps, status) with
  a managed block in its body: Build, Brett said (verbatim) + addenda, Steps, Planned & fixes, Docs. Brett's own text
  above the block is kept.
- **Docs.** Each build's expected documentation (the plugin / app readme, the build report, every `.md` its steps name)
  with a status: `none`, `draft`, `in development` (only on the build's branch, with branch and PR), `merged`.
- **Systems check.** Row *Build to-do lists follow the builds*: red when a sync failed or control@1 is off, amber when
  stale or switched off; Auto fix = sync now.
- **Off.** Disable the plugin or switch *Sync build to-do lists* off: builds keep working, the lists stop following
  them, and the note on `Builds` says *Build to-do sync is OFF* since when.

## Where things are

| Piece | File |
|---|---|
| Contract (names, categories, item mapping, plan, events) | `framework/core/build-todo-sync.mjs` (+ `.d.mts`), fixture `framework/spec/fixtures/build-todo-sync.json`, check `framework/spec/check-build-todo-sync.mjs` |
| Store fields + migration | `framework/plan/builds-store-core.mjs` (`displayName`, `category`, `area`, `nameReview`, `fixes`; older records are filled on read) |
| Store events | `framework/cli/builds-events.mjs` (subscribers in `<console root>/.axf-console/builds-subscribers.json`) |
| Orchestrator actions | `name`, `fix-add`, `fix-set`, `fix-remove` (`orchestrator.mjs act …`); control@1 `planner.builds` acts of the same names |
| Engine | `sync.mjs` (`plan`, `plans`, `names`, `suggest`, `builds`, `build`, `docs`, `step`) |
| Server | `server/__init__.py` — REST under `/api/plugins/build-todo-sync`, capability `build-todo-sync@1` |
| Web | `web/index.tsx` (page, name dialog, settings), `web/core.ts` (pure, `test.mts`) |
| Data | `.axf-console/plugins/build-todo-sync/` — `settings.json`, `links.json`, `asks.json`, `state.json`, `sync.log` |

## Commands

Every route is a plugin command (plugin-commands@1): REST `/api/control/build-todo-sync/<command>`, MCP
`build_todo_sync_<command>`, CLI `axf build-todo-sync <command> --field value`, and voice through Molly.

| Command | Does |
|---|---|
| `state` | on/off, last sync, drift, open asks, builds still to name |
| `names` | builds whose name / category still need Brett's OK, with suggestions |
| `suggest --title …` | a short name + category for a title |
| `name --id … --displayName … --category …` | name a build / confirm the suggestion |
| `sync [--dry] [--full]` | sync now |
| `asks`, `answer --id … --decision approve\|deny` | the owner asks (answer = Brett's own console only) |
| `plans`, `plans-sync [--builds …]` | the plan per build; make / refresh them |
| `build --build_id …` | one build: names, steps, fixes, docs, plan, list |
| `build-list`, `build-plan`, `build-plan-make`, `build-docs` | the to-do list, the plan, make the plan, the docs |
| `fixes`, `fix-add --text … [--kind planned\|fix\|bug]`, `fix-set --fix f1 --done true`, `fix-remove --fix f1` | the Planned & fixes checklist |
| `note --said "…" [--source voice]` | an addendum (verbatim) on the build's origin and plan |
| `settings`, `settings-set` | the settings |

Orchestrator CLI: `orchestrator.mjs act name <id> "<short name>" --category Plugin`, `act fix-add <id> <text> --kind bug`,
`act fix-set <id> f1 done`, `act fix-remove <id> f1`.

## Settings

Settings → Plugins → Build to-do sync: *Sync build to-do lists* (on), *Prompt me to name a new build* (on), days in
Done (7), full reconcile every (10 min), check the store file every (60 s), console link base.

## Tests

```bash
node framework/spec/check-build-todo-sync.mjs           # contract + store fields + fixture
python3 apps/console-web/plugins/build-todo-sync/test.py  # server: names, sync, check-off, asks, fixes, plans, docs, off, health
npx -y tsx apps/console-web/plugins/build-todo-sync/test.mts
node framework/cli/plugin-lifecycle.mjs check build-todo-sync
```

## Lifecycle

```bash
node apps/console-web/plugins/build-todo-sync/install.mjs      # data folder + the store-event subscription
node apps/console-web/plugins/build-todo-sync/uninstall.mjs --all
```

The lists it made stay in the to-do manager after an uninstall; the note on `Builds` says they stopped syncing.
