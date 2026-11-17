# BUILD-PIPELINE — the pipeline record and the slot-hold rule (build-pipeline@1)

Status: contract since Nov 8 2026 (`urgent-rebuild-pipeline-orchestrator-ids-splits-`, Fable); exit transition Nov 14 2026
(`fix-build-whose-session-finishes-phase-e`); slot hold Nov 17 2026 (`builds-keep-their-slot-across-phases`, Fable).
Reference implementation: `framework/core/build-pipeline.mjs` (pure, IO-free). The dispatcher that applies it runs only on the
VPS host (`apps/console-web/plugins/build-orchestrator/pipeline.mjs`, rules in `pipeline-core.mjs`).
Checks: `node framework/spec/check-build-pipeline.mjs` (golden cases in `fixtures/build-pipeline-exit.json`; regenerate with
`--write`). No Kotlin twin: builds show only in the web console while Android is on hold (see PORTING.md).

## Why

Brett, Nov 17 2026 (verbatim): "They didn't go back online. They finished. That is retarded. I want the 8 that are running to
finish before the rest go."

What happened: a session ends when its phase is done (Fable steps ticked, Opus steps left). The exit rule put the build back in
the Queue at its place and freed its agent slot. The dispatcher then handed that slot to whichever Queue build came next, so
eight builds that were mid-way stopped making progress while new ones started. From Brett's seat the running builds "finished"
although they had steps left.

The rule now: **a build keeps its slot from its first launch until it is merged.** A phase end is a hand-off between two
sessions of the same build, never a return to the Queue. A queued build only starts when a slot is free, and a slot held by a
build between its phases is not free.

## The pipeline record

`pipeline` on a builds@1 build (kept across orchestrator, Pending and Queue writes; only the dispatcher and the Queue actions
change it). Every field is normalised by `normPipeline()`; `emptyPipeline()` is the record at rest.

| Field | Meaning |
|---|---|
| `queuedAt`, `queuedBy` | when it entered the Queue ('' in Pending) and who put it there (brett, auto, console, …) |
| `account`, `session` | the Claude account and tmux session (`axf-<id>--<agent>`) of the current / last run |
| `slot` | **the slot hold** (below): `{ holder, account, model, since, entry, released }` |
| `model`, `phase` | the model and phase name the current / last run was launched for |
| `launchedAt`, `dispatchedAt`, `pickedAt` | ISO of the current / last launch, the dispatch that started it, the final account decision |
| `runs`, `crashes` | sessions that have run it; failed exits among them (the crash limit counts crashes, never a clean phase end) |
| `lastRun` | `{ at, exit, outcome, reason, stepsLeft, account, session, phase }`; outcome in `OUTCOMES`, reason in `EXIT_REASONS` |
| `split`, `splitRequested` | how its steps were made (claude, rules, hand); a (re)split asked for |
| `note` | one plain line the Pipeline view shows |
| `route` | '' (auto) · `api` · `subscription`: Brett's per-build account override |
| `planned`, `tried` | the orchestrator's plan `{ model, account, kind, at, why }`; accounts that refused the launch |
| `heldAt`, `heldBy`, `heldWhy` | On hold: stays in the Queue, skipped by the dispatcher until released |

### `slot` — the slot hold

```
slot: { holder: '' | <build id>, account, model, since, entry, released: null | { at, by, why } }
```

| Field | Meaning |
|---|---|
| `holder` | the build id while the build holds a slot; '' = no slot held. Set at the first launch, cleared only by a release. |
| `account` | the Claude account the slot is on for the current / last session |
| `model` | the model the current / last session started on |
| `since` | ISO of the first launch: when the hold began (kept across every phase, retry and hand-off) |
| `entry` | the agent-slots entry id of the live session; '' between sessions (the hold stays) |
| `released` | the last release `{ at, by, why }` (`why` in `SLOT_RELEASES`), null while held or never held |

Helpers: `holdsSlot(b)`, `takeSlot(slot, { id, account, model, entry, at })` (first launch starts the hold, a later launch keeps
`since`), `handoffSlot(slot)` (session ended, hold kept, `entry` cleared), `releaseSlot(slot, { at, by, why })`, `slotEntry(p)`.

Compatibility: records written before Nov 17 2026 carry `slot` as a string (the agent-slots entry id). `normPipeline()` reads a
string as `{ holder: '', entry: <the string> }`: no hold. The migration below gives the running ones their hold.

## Table states

builds@1 keeps its statuses (`pending queued running waiting blocked failed built complete archived`). build-pipeline@1 reads
them, together with the slot hold, as the pipeline state (`stateOf(b)`, `PIPELINE_STATES`):

| State | When | Table (`tableOf`) | Tab (`tabOf`) |
|---|---|---|---|
| `pending` | status pending | Pending | pending / incomplete / errors |
| `queued` | status queued, no slot held | Queue | queue |
| `phase-handoff` | status queued **and** a slot held: a phase ended (or a session crashed) and the next session has not started yet | Building | active |
| `building` | status running or waiting | Building | active |
| `landing` | status built, slot held: every step done, the PR waits to merge | — | complete |

`phase-handoff` is a state, not a builds@1 status: the store, the Queue actions and every older reader keep working, and the
dispatcher tells a hand-off from a plain Queue entry by `holdsSlot(b)`. A build in `phase-handoff` shows in the Building table
(it is one of the running builds) and never in the Queue tab.

## The exit transition (`nextStatusOnExit`)

In: `{ exit, stepsLeft, runs, crashes, phaseDone, upgradeBlocked, needsBrett }`. Out: `{ status, outcome, reason, crashes,
keepQueue, slot, state }`. `slot` is `keep` or `release`; `state` is the pipeline state after the exit.

| Reason | Status | Outcome | Slot | State after |
|---|---|---|---|---|
| `all-done` | built (complete when there is no open PR) | finished | keep (release on complete) | landing |
| `phase-done` | queued | requeued | **keep** | **phase-handoff** |
| `crash` (under `maxRuns`) | queued | requeued | **keep** | **phase-handoff** |
| `crash-limit` | pending | failed | release (`failed`) | pending |
| `upgrade-blocked`, `needs-brett`, `stopped` | pending | returned | keep | pending |

Rules:

- A clean phase end keeps the slot and moves the build to `phase-handoff`: it is next in line for its own slot and never goes
  behind a queued build. It is not a crash; `crashes` is unchanged and `queuedAt` is untouched.
- A crash under the limit keeps the slot too: the retry is the same build going on, not a new one.
- The slot is released on exactly three things: **merged** (status complete; `SLOT_RELEASES` `merged`), **failed** (the crash
  limit or a failed status; `failed`), and **cancelled by Brett** (unqueue, hold, archive, delete, or Release slot; `cancelled`).
  A stop that needs Brett keeps the slot: when he answers and re-queues the build it goes on ahead of the Queue, as a running
  build would. He can release it by hand if he wants the slot back.
- `built` (PR open, not merged) keeps the slot: done means merged (`DONE-MEANS-MERGED.md`); a fix session after red CI runs in
  the same slot. The lander's merge releases it (`releaseOnStatus('complete')`).

## Dispatch order (`pickNext`)

In: the live builds, `max` (the agent-slot cap), `priorityOf`. Out: `{ holders, handoff, free, order, waits }`.

- `holders(builds)`: every build that holds a slot (any status but complete, failed, archived, deleted).
- `handoff(builds)`: holders with no live session (state `phase-handoff`), oldest hold first (`slot.since`, then `queuedAt`).
- `freeSlots(builds, max)` = `max − holders.length`, never below 0. A held slot is never free, whether its session is live or
  between phases.
- `order`: every hand-off build first (they already own a slot: they take none of the free ones), then Queue builds in
  `queueOrder` (priority, then `queuedAt`) up to `free`.
- **A queued build never starts while a hand-off build is waiting for its next phase.** When `handoff` is non-empty the Queue
  part of `order` is empty and every queued build is in `waits` with the reason (`waiting: N running builds finish first`).
  When no account can take a hand-off build's next model, the hand-off waits in its slot and the queued builds keep waiting.
- Held (On hold) queued builds are skipped as before; they are never holders (hold releases the slot).

The dispatcher (phase 2 of this build) walks `order`, routes each pick to an account (`routeFor`) and launches with the held
slot (`takeSlot`, `claude-headless.sh --held-slot <build>`).

## Migration (`migrateSlots`)

`migrateSlots(builds, now)` returns `[{ id, slot }]`: one patch per build that was running when the rule landed and holds
nothing yet. A build qualifies when its `slot.holder` is empty and either its status is running or waiting, or it is queued
with a `lastRun` of outcome `requeued` (a phase end or crash sent it back to the Queue under the old rule) and at least one
run. The hold starts at `launchedAt` (else `lastRun.at`, else `now`), on the recorded account and model, with the legacy
agent-slots id as `entry` when the session is live. Idempotent: a build that already holds a slot is left alone. Applied once
through the builds store (journalled) by `pipeline.mjs migrate-slots` (phase 2).

## Actions

`BUILD_ACTIONS` gains `release-slot` (Brett takes the slot back from a build that holds one and is not running). `actionsFor(b)`
offers it for a holder in `phase-handoff`, `landing` or Pending. `RELEASING_ACTIONS` (unqueue, hold, archive, delete,
release-slot) release the slot with `why: cancelled`; `releaseOnStatus(status)` names the release a status change implies
(`complete` → merged, `failed` → failed, else none).

## API

The slot view is read and changed without the UI (phase 2 of this build): REST `GET /pipeline/slots` and `POST
/pipeline/builds/<id>/release-slot`, the console deep link `view:builds/tab:pipeline=slots`, the MCP plugin commands
`pipeline.slots` / `pipeline.release-slot`, the CLI `pipeline.mjs slots` / `release-slot <id>`, and voice through AmberX.
All four read the same `pickNext()` result.

## Invariants (`check-build-pipeline.mjs`)

- A phase end or a crash under the limit keeps the slot and lands in `phase-handoff`; `queuedAt` and `crashes` are untouched
  by a phase end.
- Hand-off builds come before every queued build in `pickNext().order`; no queued build is in `order` while a hand-off waits.
- `freeSlots` = max − holders; a hand-off build takes no free slot.
- A release happens only on merged / complete, failed, or a Brett action; `released.why` is in `SLOT_RELEASES`.
- `migrateSlots` gives every running, waiting and requeued-with-runs build a hold and is idempotent.
- A legacy string `slot` reads as no hold with the string as `entry`.
