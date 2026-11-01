# Build tracker (orchestrator@1)

`orchestrator.json` is the build orchestrator's tracker: every build broken into steps of 30 minutes or less, each
pinned to **Fable** or **Opus**. Consecutive same-model steps are a *phase*; a phase that switches model waits for
Brett's approval. It lives in the repo (and syncs with the hub through `claude-sync`) so any session, on any machine
or Claude account, can pick a build up where the last one stopped. <!-- axf-plugin:build-orchestrator -->

## Levels

Build → **category** (`category`) → **phases** (step `phase` label; a new phase starts where the label or the model changes) → **groups** (step `group` label, consecutive steps) → **steps**. Only a model change between phases needs Brett's approval. In the console, Builds shows a Grid (one row per build, sortable, expands to the card) or a List, filtered by category. <!-- axf-plugin:build-orchestrator -->

## One builds store (builds@1, since Oct 31 2026)

Every build of every profile is ONE record in `_claude/builds/store.json`, owned by the orchestrator (core
`framework/plan/builds-store-core.mjs`, IO `framework/cli/builds-store.mjs`). A build's profiles are a field
(`profiles: [...]`, `order` per profile); Pending is a status; the build queue is the order of plan-epic builds. Every
step is its own record (`uid` never changes; `title` = rename). Every write is versioned: store `rev`, record `rev`,
and a journal line in `_claude/builds/journal/<YYYY-MM>.jsonl` (each changed build before and after).
`orchestrator.mjs`, `pending.mjs`, `build-queue.mjs`, the console, the MCP tools and the Builds page read and write
projections of it. The per-profile `orchestrator.json` files and `framework/plan/**/{pending,build-queue}.json` are
read-only exports regenerated after every write; a direct write by an old-style session is taken in newer-only.

```bash
node framework/cli/builds-store.mjs                     # rev, builds and % per profile
node framework/cli/builds-store.mjs verify              # every build, step, note and status of the old files is in the store
node framework/cli/builds-store.mjs history <id>        # every journal revision of a build
node framework/cli/builds-store.mjs restore <id> <rev>  # put it back as it was (itself versioned)
```

The Builds page (console and AmberX: Builds → Builds) shows it: Builds and Steps views, rename, drag to reorder,
divide, harvest / split into N, Restore default, a draft until Apply, live progress bars. <!-- axf-plugin:builds-page -->

## Build profiles

Each build profile (build-profiles@1, `framework/cli/profiles.mjs`) is a field on the builds in the store. The
registry is `framework/plan/profiles.json`; `orchestrator.mjs` works on the active profile's builds; check it with
`node framework/cli/profiles.mjs current` (or run one command on another profile with `AXF_BUILD_PROFILE=<id>`).
Console: banner chip / **Build profiles** dialog.

## Carry a build on

```bash
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs              # every build, steps, time left, what's next # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs next         # the next step (or the approval it waits on) # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief <id>   # paste-ready brief: the current phase only # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step <id> <stepId> [undo] # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act approve <id> <phase>   # only after Brett approves (card) # axf-plugin:build-orchestrator
```

Commit `_claude/builds/store.json` and `_claude/builds/journal/` with the work after every step. Console: **Builds → Build orchestrator** (tabs Builds,
Approvals, Rules).

## Token rules (on every build, editable in the Rules tab)

- Stay in **one session**; a step marked *new session* is the only reason to start another.
- **No sub-agents** unless a step is marked *sub-agent ok*.
- A brief carries **only the current phase**; read only the files its steps list.
- Stop at the end of a phase. When the next phase switches model, ask Brett with a card, then `act approve`.

## Which model a step gets

- **Fable:** cross-port contracts, kernel/engine internals, schema + migration design, heavy refactors, anything that
  changes how GUIs work across apps.
- **Opus:** everything else (plugin UI on the framework, servers, routes, tests, docs, wiring, security work).

Order steps to keep switches few: all Fable work of a build first where the dependencies allow, then Opus.

## Pending builds

Pending is a status of a build in the store, not a copy: the Pending list is the profile's projection of the store
and a Pending change is absorbed back into it (`framework/cli/pending.mjs`). The orch-sync bridge is retired. <!-- axf-plugin:build-orchestrator -->
