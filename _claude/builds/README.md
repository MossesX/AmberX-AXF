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

## What Brett said (build-origin@1, since Nov 3 2026)

Every build record may carry `origin` (`framework/core/build-origin.mjs`): `said` (Brett's words, verbatim), `at`,
`source` (voice / chat / console / code), `session`, `link`, `by` (who launched it), `brief` (the full brief text),
`verbatim` (false = backfilled from older text, "may be paraphrased"), `from` (brief / detail / notes when backfilled)
and `addenda` [{said, at, source, by}]. Briefs carry it in a `## Brett said (verbatim)` block (template:
`BRIEF-TEMPLATE.md`); `deploy/claude-headless.sh` records it through `framework/cli/build-origin.mjs capture`.
His words are never replaced: a different verbatim quote is refused (add an addendum); backfilled words give way to
real ones. Every merge unions it (`mergeOrigin`: store writes, the live publish, the git merge driver), and
`origins.json` next to the store keeps a copy keyed by build id that older code never touches, so a write from a
session on code from before build-origin@1 can't drop it: the next read heals the records. Commands:
`build-origin.mjs get <id> | set <id> --said … | addendum <id> --said … | missing | backfill [--apply] | block`, and
the build-orchestrator plugin's `GET /origin/{id}`, `POST /origin/{id}`, `POST /origin/{id}/addendum` (REST, MCP and
`axf build-orchestrator …` through plugin-commands@1). <!-- axf-plugin:build-orchestrator -->

## Live on main (since Nov 3 2026)

Brett: "every completed step, no matter how small, must reach the orchestrator and appear on main immediately".
Every store write that changes a build (step ticked, status, note, branch, PR) is published to **main** at once as its
own status-only commit (`Builds live: … [skip ci]`), whatever branch the session is on (`framework/cli/builds-live.mjs`):
fetched main + this checkout's changed builds, merged per build and per step **newer wins**
(`framework/plan/builds-merge-core.mjs`), journal lines appended, one line per change in THREADS.md's **Live build
log**, orchestrator exports regenerated, pushed (rebase-retry when main moved, never forced). Main's newer builds then
come back into the checkout and into the console's checkout (`/opt/axf`), so the banners show it now. Code still goes
through the branch and its PR. The console's auto-update skips the rebuild when only `_claude/` changed.

- **Status:** `built` = every step done, the build's PR not merged yet ("Built · awaiting merge"); `complete` once the
  PR merged (`mergedAt`) or when the build has no PR.
- **Reconciler** (`framework/cli/builds-reconcile.mjs`): open and merged PRs and `claude/*` branches matched to builds
  (branch/PR field, branch name = build id or id-prefixed, PR title/body/commits naming the build's steps as done);
  fills blank branch/PR, ticks steps a PR names (step note = the PR), records merges, lists orphans. Runs at session
  start (`.claude/settings.json` hook), every 10 min on the VPS (cron `axf-builds-reconcile`), and by hand.
- **Merging a branch:** the builds files merge newer-wins through the `axf-builds` git driver (`.gitattributes`,
  registered per clone by `builds-live.mjs install`); a PR that conflicts only there: `builds-live.mjs heal <branch>`.
- **Broken:** changes that can't reach main stay queued (`builds-live.mjs status`); the systems check item
  **Builds reach main live** turns red after 15 min, amber for orphan PRs/branches or a reconciler that hasn't run.

```bash
node framework/cli/builds-live.mjs sync                 # session start: send what is newer here, take main's newer builds
node framework/cli/builds-live.mjs status | flush       # outbox, last publish, last error / publish now
node framework/cli/builds-live.mjs link <id> --branch <b> --pr <n> [--merged]
node framework/cli/builds-reconcile.mjs [--apply]       # dry run / write what it is sure of + the report
```

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
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs request-upgrade <id> <phase>  # at a model UPGRADE: ask Brett, then stop # axf-plugin:build-orchestrator
node framework/cli/model-gate.mjs audit                                                     # upgrades approved so far, and by whom # axf-plugin:build-orchestrator
```

Every tick goes live to main by itself (see *Live on main*); never trust a branch's or main's export alone: run
`builds-live.mjs sync` (the session-start hook does) before reading. Console: **Builds → Build orchestrator** (tabs Builds,
Approvals, Rules).

## Token rules (on every build, editable in the Rules tab)

- Stay in **one session**; a step marked *new session* is the only reason to start another.
- **No sub-agents** unless a step is marked *sub-agent ok*.
- A brief carries **only the current phase**; read only the files its steps list.
- Stop at the end of a phase. A phase that switches to a **lower** model (Fable → Opus) just goes on (recorded). A phase that switches to a **higher** model (Opus → Fable) is Brett's call only (Nov 3 2026): run `request-upgrade`, tell him, and stop. Never `act approve` an upgrade yourself (it is refused for sessions, agents and headless builds anyway); he approves in the console or on axHub.

## Which model a step gets

- **Fable:** cross-port contracts, kernel/engine internals, schema + migration design, heavy refactors, anything that
  changes how GUIs work across apps.
- **Opus:** everything else (plugin UI on the framework, servers, routes, tests, docs, wiring, security work).

Order steps to keep switches few: all Fable work of a build first where the dependencies allow, then Opus.

## Pending builds

Pending is a status of a build in the store, not a copy: the Pending list is the profile's projection of the store
and a Pending change is absorbed back into it (`framework/cli/pending.mjs`). The orch-sync bridge is retired. <!-- axf-plugin:build-orchestrator -->

## Model & thinking (model-advice@1, since Nov 4 2026)

Brett: "Go through my list of things that can be done and see what should be redone with Fable and put that next to it,
and put the level of thinking that it should be on." Every build and step carries a recommended model (Fable / Opus),
a thinking level (low / medium / high / max = `claude --effort`) and why, from one engine
(`framework/core/model-advice.mjs`): foundation or contract work = Fable, high or max; plugins and screens = Opus,
medium; wording, small fixes and landing = Opus, low; gnarly debugging or architecture = Opus, high. Built work gets a
verdict: keep, Fable review (read on Fable, fix what is wrong) or redo on Fable, with a cost. Recommendations only:
nothing changes model by itself.

- **Record fields** (builds@1, every build and step): `thinking`, `recommendedModel`, `recommendedThinking`, `modelWhy`,
  `adviceKind`, `advicePinned`, `adviceAt`, `reviewOk`; builds also `verdict`, `adviceCost`. Every projection and read
  (orchestrator, Pending, queue, Builds page, `planner.builds`, `pending_list`, `build_queue`) adds the view: `model`,
  `thinking`, `recommendedModel`, `recommendedThinking`, `reviewStatus` (ok / look / dismissed), `modelWhy`, `verdict`.
- **The icon:** green check = on its recommendation (or Brett OK'd it as is); yellow triangle = the recommendation
  differs, or built work to review / redo. Right-click or long-press it: the row expands with why (now vs recommended,
  reasons, what could go wrong, cost) and **Apply** / **Dismiss**, which only Brett can do (his console click or an
  axHub approval; a session, agent or token caller is refused like a model upgrade). A change after his OK brings the
  triangle back. One component for every screen: `framework/react/components/ModelAdvice.tsx`.
- **On / off:** Settings → Builds → Show model & thinking (global, mirrored to the Claude setting
  `builds.showModelThinking` on axHub) with a per-screen override; filters (model, thinking, check / triangle, Needs a
  look, Fable candidates) are one shared setting every list reads. Voice: console actions `model-advice.show on|off|toggle`,
  `model-advice.filter needs a look | fable candidates | model:Opus thinking:high | clear`, `model-advice.screen <id> on|off|inherit`.
- **Sidecar:** `_claude/builds/advice.json` keeps every recommendation and OK next to the store (like `origins.json`), so a
  session on older code can't drop them; every read heals, every write folds, the live publish merges it.
- **Launcher:** the build's thinking level becomes `claude --effort` (`AXF_THINKING`, build_start, `deploy/claude-headless.sh`).

```bash
node framework/cli/model-advice.mjs audit [--write] [--force]     # every build + step, every profile (writes the store)
node framework/cli/model-advice.mjs plans [--write]               # Plan Studio plans
node framework/cli/model-advice.mjs queue                         # queued / running headless builds, from their briefs
node framework/cli/model-advice.mjs report                        # _claude/builds/reports/model-thinking-audit.md
node framework/cli/model-advice.mjs show <build>                  # one build, its steps, why
node framework/cli/model-advice.mjs set-thinking <build> [<step>] <level>
node framework/cli/model-advice.mjs apply|dismiss <build> [<step>]   # Brett only (refused for a session)
node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act '{"action":"advise","id":"<build>"}'   # axf-plugin:build-orchestrator
node framework/spec/check-model-advice.mjs                        # the contract (CI)
```
Curated overrides (pinned): `_claude/builds/model-advice.json` (`builds` by id, `picks` = the top "redo on Fable" list).
