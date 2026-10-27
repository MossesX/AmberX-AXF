# One builds dataset — builds@1

Brett, Oct 27 2026: the Plan, Tracker, Build queue, Pending builds and Build orchestrator were five files that
drifted (a pending item marked complete never marked its plan entry built; 91 of 100 pending items were linked to
nothing). From this build there is **one dataset, `framework/plan/plan.json`**, and the five lists are **views** of
it. The other four files still exist, but as **generated exports** that every save rewrites, like `tracker.json`
always was. Nothing writes them by hand any more.

```
plan.json  (plan@1, additive)             ← the only thing anyone edits
  ├─ pending.json      (pending@1)        ← export: the Pending builds list
  ├─ build-queue.json  (build-queue@1)    ← export: the Build queue state
  ├─ orchestrator.json (orchestrator@1)   ← export: the Build orchestrator tracker (_claude/builds/)
  ├─ status.json       (catalog status)   ← export: catalog feature statuses (Android console, tracker.mjs)
  └─ tracker.json      (tracker@1)        ← export: catalog × status, flattened
```

Logic: `framework/plan/builds-core.mjs` (pure, IO-free; the reference), IO + exports: `framework/cli/builds.mjs`.
Every older core (`pending-core.mjs`, `build-queue-core.mjs`, the orchestrator's `orchestrator-core.mjs`) keeps its
API and its state shape; it now gets that state **derived from the plan** and writes it **back into the plan**
through builds-core. Readers of the export files (Python server parts, the activity feed, alerts, backfill) keep
working unchanged for one release; the Opus phase moves them to the plan.

## Shape

`plan@1` is unchanged for every reader that exists today: `features[]` keeps every field. Two additions, both
optional, so an unmigrated plan or an old reader is never broken:

### Top level: `builds`

```json
"builds": {
  "$axf": "builds@1",
  "updatedAt": "2026-10-27T19:00:00.000Z",
  "artifact": "https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye",
  "queue": { "order": ["x.assets", "x.engines"], "dirty": false, "updatedAt": "…", "history": [{ "at": "…", "by": "console", "text": "…" }] },
  "rules": { "sameSession": true, "subAgents": false, "approveModelSwitch": true, "maxStepMinutes": 30 },
  "migratedAt": "…",
  "migratedFrom": { "pending": 100, "queue": 54, "orchestrator": 5 }
}
```

- `artifact` is `pending@1.artifact` (the claude.ai Pending Builds page).
- `queue` is `build-queue@1` without its `steps` map: the per-epic records moved onto the epics (below).
- `rules` are `orchestrator@1.rules`.

### Per feature: `build`

A feature is **a build** once it carries `build`. Every field in it is optional; a missing block means "not on
that list".

```json
"build": {
  "parked":        { "pendingId": "lib-mcp", "source": "chat", "planId": "x.lib.mcp", "createdAt": "…", "updatedAt": "…", "builtAt": "…" },
  "record":        { "completedAt": "…", "completedBy": "console", "deps": ["x.assets"], "rework": null, "reopenedAt": "…", "reworkedAt": "…" },
  "estimate":      "45 min",
  "steps":         [ { "id": "s1", "text": "…", "estimate": "25 min", "model": "fable", "why": "…", "phase": "Phase 1", "group": "Data",
                       "files": ["…"], "checks": ["…"], "session": "same", "agent": false, "done": true, "doneAt": "…", "at": "…", "note": "" } ],
  "notes":         [ { "text": "…", "at": "…" } ],
  "orchestration": { "id": "builds-one-page", "category": "Console UI", "branch": "claude/builds-one-page", "pr": "", "source": "chat",
                     "approvals": [ { "phase": 1, "from": "Fable", "to": "Opus", "at": "…" } ], "createdAt": "…", "updatedAt": "…", "builtAt": "…" },
  "hidden":        false,
  "archived":      false
}
```

| Block | Present ⇔ | Came from |
| --- | --- | --- |
| `parked` | the build is on the **Pending builds** list | `pending@1` item (`pendingId` keeps the item's own id when it differs from the feature's; `planId` keeps a link that pointed at an id the plan doesn't have) |
| `record` | the **Build queue** recorded something for this epic | `build-queue@1.steps[epic]` (`completedAt`, `completedBy`, `deps`, `rework`, `reopenedAt`, `reworkedAt`) |
| `estimate` | the build has its own time | pending `estimate` / queue `StepRecord.estimate` / a plan feature's `estimate` |
| `steps` | the build is split into small steps | pending `subPrompts` + queue `StepRecord.steps` + orchestrator `steps`, **one list** (see Steps) |
| `notes` | someone left a note | pending `notes` / orchestrator `notes` |
| `orchestration` | the build is in the **Build orchestrator** | `orchestrator@1` build (`id` keeps the build's own id when it differs) |
| `hidden`, `archived` | hidden from / archived on the orchestrator and pending grids | orchestrator `hidden`; `archived` was orchestrator status `archived`; pending-grid-view adds both to the pending list |

### One model field

`feature.model` (`fable` / `opus` / `sonnet`, lowercase, with `modelReason`) is the only model. The Pending list's
"waits on" and the orchestrator's build model are that field capitalised (`Fable` / `Opus` / `Sonnet`); a model set
from one of those views writes `model` + `modelEdited: true`. A step's `model` is optional and defaults to the
feature's.

### One status, mapped per view

`feature.status` is the only status. `plan@1.statuses` gains three values so nothing the lists knew is lost:

```
built · partial · in-progress · placeholder · planned · unsafe · blocked · failed · broken · dropped
```

| plan status | Pending view (`pending@1`) | Orchestrator view (`orchestrator@1`) | Queue state |
| --- | --- | --- | --- |
| built | complete | complete (archived when `build.archived`) | done / rework |
| partial, in-progress | pending | running (waiting when the next phase needs an approval) | active |
| planned, placeholder | pending | pending | queued |
| unsafe | unsafe | blocked | queued |
| blocked | pending | blocked | blocked |
| failed | failed | failed | queued |
| broken | broken | blocked | queued |
| dropped | — (not listed) | archived | dropped |

Writing back (`…IntoPlan`): a view's status is written to the plan **only when the view changed it** (its status
differs from what the same view derived before the change), through the reverse map: pending `pending → planned`
(a running build stays in-progress), `unsafe → unsafe`, `broken → broken`, `failed → failed`, `complete → built`;
orchestrator `pending → planned`, `running | waiting → in-progress`, `blocked → blocked`, `failed → failed`,
`complete → built`, `archived → build.archived = true` (status untouched). So **marking a pending item complete now
marks the plan entry built**, the queue step done and the orchestrator build complete, because they are one entry.

### Steps

One list per build. Fields beyond `text` are optional; each view reads what it knows:

| field | Pending (`subPrompts`) | Queue (`StepRecord.steps`) | Orchestrator (`steps`) |
| --- | --- | --- | --- |
| `id` | — (index) | — (index) | `id` (`s<n>` when missing) |
| `text`, `estimate`, `done`, `doneAt` | ✓ | ✓ | ✓ |
| `at` | ✓ (`at`, when the step was written) | — | — |
| `model`, `why`, `phase`, `group`, `files`, `checks`, `session`, `agent`, `note` | — | — | ✓ |

Ticking a step in any view ticks it everywhere. The small-steps rule (`splitCheck`, 30 min) reads this list.

### Identity and kinds

- An entry born on the Pending list or in the orchestrator (no plan feature of its own) becomes a feature with
  `kind: "build"`, `source` = the item's source (`chat`, `console`, `artifact`, `claude-code`, `mcp`, `pending`,
  `fable-rebuilds`, …), `area: "Builds"` (or the orchestrator category) and the item's id. A pending item linked by
  `planId` to a plan feature attaches to it (`build.parked.pendingId` keeps the item's id); an orchestrator build
  linked by `pendingId` attaches to that entry.
- Plan rebuilds (`plan.mjs`, `buildPlan`) keep every feature whose `source` is not `seed` / `catalog`, and carry the
  `build` block of a seed / catalog feature onto its regenerated copy, so a rebuild never loses a list.
- Catalog features carry `tab`, `groupId` and `tag` (ids, next to the labels in `area` / `group`) so the tracker
  export needs nothing but the plan.

## Views

`builds-core.mjs` computes every list from one plan:

| view | function | shape |
| --- | --- | --- |
| Pending | `pendingState(plan)` | `pending@1` (items in plan order; sort with `pending-core.sortItems`) |
| Queue | `queueState(plan)` | `build-queue@1` (`order`, `steps` map, `dirty`, `updatedAt`, `history`); `computeQueue(plan.features, queueState(plan))` as before |
| Orchestrator | `orchestratorState(plan)` | `orchestrator@1` (`rules`, `builds`) |
| Tracker | `trackerState(plan, catalog)` | `tracker@1` (`summary`, `items`) |
| Plan | `plan.features` | unchanged |
| Rows | `rows(plan, { view, filters })` | one row per build with the nested info every view shows (steps, notes, dependencies, linked features, phases, history) — what the Builds page draws |

Write-backs: `pendingIntoPlan(plan, state)`, `queueIntoPlan(plan, state)`, `orchestratorIntoPlan(plan, state)`.
Each is a pure merge that touches only the fields its view owns; round trips are lossless
(`state == view(intoPlan(plan, state))`), pinned by `framework/spec/fixtures/builds.json` +
`framework/spec/check-builds.mjs` (CI).

## Migration (`node framework/cli/builds.mjs migrate [--write]`)

Dry run by default: reads the four files, builds the merged plan, prints what attaches where and what would be
lost (nothing, or it refuses). `--write` writes `plan.json` with the `builds` block, regenerates the four exports
from it and keeps `*.pre-builds.json` copies beside the originals for one release. Runs the same way on the hub
copy (`/projects/amberx-axf/_data`, through `persist.mjs`) and on a repo checkout. A plan without a `builds` block
is read as unmigrated: `builds.mjs` then derives the views from the old files read-only, so nothing breaks before
the migration runs.

## Android

Deferred twin (Android hold): the Kotlin `catalog` models read `tracker@1`, which stays as an export.
`PORTING.md` records `builds@1` as a deferred kernel model.
