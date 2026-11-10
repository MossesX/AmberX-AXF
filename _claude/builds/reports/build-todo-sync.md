# Build to-do sync — build report

Build `build-todo-sync` (Current profile), Fable, agent Snap Sully, branch `claude/brett-todo-sync`, Nov 4 2026.

## What Brett said (verbatim)

> For every build from now on, like this plugin build, prompt me for a name which will be used to reference it in the
> to-do manager. Then we're going to add a list in the to-do manager with all the steps that Orchestrator broke it into.
> And then it will check off each one in real time as the orchestrator processes each step. So the to-do list for every
> build has the same exact steps as items in the to-do list that the orchestrator broke the build down into. The builds
> into categories: plugins, plugin extensions, add-ons, framework, app, feature, module. Sync the build manager with
> the to-do manager and the real-time checklist. Put this in the planner.

Addenda: "This is a plugin too." · "From now on, put every build in Plan Studio. … Every build will be able to attach a
list to it of planned things to do, and you can check off the fixes as they happen." · "And that needs an API so it
can be voice controlled." · "And the planner will also have links to documentation that's under development."

## What was built

**Framework (Fable)**

- `framework/core/build-todo-sync.mjs` (+ `.d.mts`), contract **build-todo-sync@1**: the seven categories,
  `suggestDisplayName`, `suggestCategory`, `naming` (fills `displayName`, `category`, `area`, `nameReview` on any
  record), `normFix` / `itemForFix` (Planned & fixes), `itemFor` (a step as an AmberX to-do item: numbered title, model /
  estimate / phase / agent / handed-to in the text, state tags held / blocked / failed / rejected / skipped / handed,
  a link back), `placeOf` (category, Done for 7 days, Archive), `plan()` (control@1 `amberx.lists` / `amberx.items`
  commands that make a snapshot match the store; idempotent; `$ref` placeholders; drift = owner ticks, strays, deleted
  lists), `asksFrom` / `mergeAsks`, `storeEvent` / `parseEvent`. Fixture `spec/fixtures/build-todo-sync.json`, check
  `spec/check-build-todo-sync.mjs` (22 checks, in-memory to-do manager replaying the ops).
- builds@1 (`framework/plan/builds-store-core.mjs`): `displayName` (≤ 48), `category` (enum), `area` (the old free
  text), `nameReview`, `fixes[]` on every record; older files are filled on read; `validateStore` checks them; the
  orchestrator projection round-trips them. `pending-core` passes `name` / `category` through.
- Orchestrator core: actions `name`, `fix-add`, `fix-set`, `fix-remove`; `add` and `update` take the new fields; the CLI
  `act name <id> "<name>" --category <cat>`, `act fix-add|fix-set|fix-remove`.
- control@1 (`core/engines/control-rules.mjs`, `schemas/control.json`): `planner.builds` fields + acts `name`,
  `fix-add`, `fix-set`, `fix-remove` (token-control's planner maps them to the orchestrator).
- Store events: `framework/cli/builds-events.mjs` (subscribers in the console root's `.axf-console/builds-subscribers.json`);
  `builds-store.mjs` posts a frame after every write and after a pull from main; `builds-store.mjs backfill-names`.
- MCP `pending_change` gained `name` and `category`.

**Plugin `apps/console-web/plugins/build-todo-sync`**

- Server (Python): snapshot through control@1, plan through `sync.mjs`, run ops with ref resolution, `links.json`,
  `asks.json` (owner-only answers: Brett's signed-in console or a token-less console), `/events` intake with a debounce,
  store-file poll + full reconcile timer, sync note on the Builds list (says OFF when disabled), health@1 row with
  Auto fix, capability `build-todo-sync@1`. Plan Studio through plans@1: a plan per mirrored build with a managed block
  (Build · Brett said + addenda · Steps · Planned & fixes · Docs), Brett's own text kept, addenda as verbatim comments.
  Docs per build with status none / draft / in development (on the build's branch) / merged.
- Engine `sync.mjs`: `plan`, `plans`, `names`, `suggest`, `builds`, `build`, `docs`, `step`.
- Web: page *Build to-do lists* (sync state, asks with Approve / Deny, name forms, mirrored builds by place), dialog
  *Name this build* (auto-prompt once per new build; Builds → Name a build…), settings tab (on/off, auto-prompt,
  days in Done, reconcile, poll, link base), lifecycle panel. Tokens and framework controls only.
- Orchestrator UI: Add form takes a short name (suggested live) and a category; cards show the name, "name to confirm",
  area and the fixes count; Edit sets name / category / area.
- Commands (plugin-commands@1 → REST, MCP `build_todo_sync_*`, CLI, voice): state, names, suggest, name, sync, asks,
  answer, plans, plans-sync, build, build-list, build-plan, build-plan-make, build-docs, fixes, fix-add, fix-set,
  fix-remove, note, settings, settings-set.
- Tests: `test.py` (server: names, backfill, live check-off from an event, asks owner-only approve / deny, fixes,
  API for fixes / notes / docs / plan / list, plans sync, off note, Done, health), `test.mts` (web core), lifecycle and
  commands checks, help entries.

## Decisions

- The builds store is the only source of truth; the to-do list and the plan are synced views. A step tick in the
  to-do manager asks Brett; a Planned & fixes tick applies at once.
- `category` is the enum; the old free text moved to `area` (a non-enum value in `category` reads as the area).
- The plugin reaches the to-do manager and the orchestrator only through capabilities (control@1, plans@1), never
  another plugin's folder.
- Docs status is computed, not stored: on main = merged (or draft when thin), on the build's branch = in development.

## Known gaps

- Plan Studio renders the Planned & fixes and Docs through the plan body's managed block; a dedicated UI section in the
  plan editor is a follow-up.
- The Build manager's rows do not yet show the fixes / docs chips (the orchestrator card does).
- Molly voice phrases come from the plugin commands registry; no hand-written phrases were added.

## Checks

See the PR description for the exact runs.
