# Build tracker (orchestrator@1)

> **builds@1 (Oct 27 2026):** once `framework/plan/plan.json` carries the one builds dataset (`node framework/cli/builds.mjs migrate --write`), this file is a **generated export** of it: every build here is a plan entry with a `build.orchestration` block, `orchestrator.mjs` reads and writes the plan, and this file is rewritten on every save (never edit it by hand after that). Spec: `framework/spec/BUILDS.md`. <!-- axf-plugin:build-orchestrator -->

`orchestrator.json` is the build orchestrator's tracker: every build broken into steps of 30 minutes or less, each
pinned to **Fable** or **Opus**. Consecutive same-model steps are a *phase*; a phase that switches model waits for
Brett's approval. It lives in the repo (and syncs with the hub through `claude-sync`) so any session, on any machine
or Claude account, can pick a build up where the last one stopped. <!-- axf-plugin:build-orchestrator -->

## Levels

Build → **category** (`category`) → **phases** (step `phase` label; a new phase starts where the label or the model changes) → **groups** (step `group` label, consecutive steps) → **steps**. Only a model change between phases needs Brett's approval. In the console, Builds shows a Grid (one row per build, sortable, expands to the card) or a List, filtered by category. <!-- axf-plugin:build-orchestrator -->

## Build profiles

Each build profile (build-profiles@1, `framework/cli/profiles.mjs`) has its own tracker: **Main framework** (base) =
`_claude/builds/orchestrator.json`, any other profile = `_claude/builds/profiles/<id>/orchestrator.json` (Refactor:
`profiles/refactor/`). `orchestrator.mjs` reads the active profile's; check it with `node framework/cli/profiles.mjs current`
(or run one command on another profile with `AXF_BUILD_PROFILE=<id>`). Console: banner chip / **Build profiles** dialog.

## Carry a build on

```bash
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs              # every build, steps, time left, what's next # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs next         # the next step (or the approval it waits on) # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief <id>   # paste-ready brief: the current phase only # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step <id> <stepId> [undo] # axf-plugin:build-orchestrator
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act approve <id> <phase>   # only after Brett approves (card) # axf-plugin:build-orchestrator
```

Commit `orchestrator.json` with the work after every step. Console: **Builds → Build orchestrator** (tabs Builds,
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
