# BUILDS — the one builds store (builds@1)

Status: contract since Oct 31 2026 (Urgent `urgent-builds`, Opus); reviewed on Fable Nov 1 2026 (`_claude/builds/reports/fable-review.md`).
Reference implementation: `framework/plan/builds-store-core.mjs` (pure, IO-free) + `framework/cli/builds-store.mjs` (files, lock,
journal, exports). Checks: `node framework/spec/check-builds-store.mjs`, `node framework/cli/builds-store.mjs verify`.
Python has no second implementation: the console's builds-page server shells to the CLI (`builds.mjs --json`), so there is one
writer. No Kotlin twin: the store is build tooling, not an app contract (nothing an Android app renders).

## Why

The same builds used to live in five places per profile (orchestrator.json, pending.json repo + hub, build-queue.json, plan
epics) and drifted. Now every build of every profile is **one record** in `_claude/builds/store.json`, owned by the Build
orchestrator, and every older list is a **projection** of it. Nothing is ever dropped: deletes are soft and every write is
journalled.

## Store

```
{ $axf: 'builds@1', rev, updatedAt, migratedAt,
  rules:  { <profile>: orchestrator rules },
  meta:   { queue: { <profile>: { dirty, updatedAt, history } }, pending: { <profile>: { artifact, updatedAt } } },
  drafts: { <profile>: { ops: [Op…], updatedAt, by } },
  builds: [BuildRecord…] }
```

**BuildRecord** = the orchestrator@1 build fields (`id`, `title`, `category`, `detail`, `status`, `hidden`, `source`,
`pendingId`, `branch`, `pr`, `createdAt`, `updatedAt`, `builtAt`, `notes`, `approvals`, `steps`) plus:

| Field | Meaning |
|---|---|
| `profiles: [id…]` | the build profiles it belongs to: a field, never a copy (one record shown in each) |
| `order: { <profile>: n }` | its place in each profile's list; the build queue is this order for plan epics |
| `kind: build \| epic` | epic = a plan epic (`planRef` = the plan feature id) |
| `rev` | bumped on every change (the journal keeps every revision) |
| `deleted`, `deletedAt` | soft delete |
| `pending` | what only the Pending list knew (model, own status, estimate, source, planId, step dates, `[Model]` prefix flag) or null |
| `queue` | the build-queue record of an epic (completedAt, deps, rework, estimate…) or null |
| `defaultSteps`, `defaultAt`, `rearranged` | the default breakdown (Restore default); follows orchestrator edits until the Steps view rearranges the build |
| `removedSteps` | steps taken out (removed, divided, harvested away) with why, when, by |
| `legacy`, `copies` | where the record came from in the migration; other copies kept verbatim |

**StepRecord** = orchestrator@1 step fields (`id`, `text`, `model`, `why`, `phase`, `group`, `estimate`, `files`, `checks`,
`session`, `agent`, `skip`, `done`, `doneAt`, `note`) plus `uid` (never changes, also across a harvest), `title` (rename),
`rev`, `createdAt`, `updatedAt`, `origin { build, step, how: divided | harvested }`.

Statuses: `pending running waiting blocked failed complete archived`. Step models: **`Fable` or `Opus` only** (model
policy `framework/core/model-policy.mjs`; a legacy `[Sonnet]` prefix reads as Opus).

## Invariants (`validateStore`)

- `$axf` is `builds@1`; `rev` a whole number; builds a list.
- Build ids unique; a build has an `order` in every profile in `profiles`; `kind` build | epic; `rev` ≥ 1; ISO timestamps.
- Live step `uid`s unique across the whole store (a harvested step keeps its uid and leaves its source build); step ids
  unique within a build; every step `Fable` or `Opus` with text.
- Ids never change: renaming changes `title` only.

## Projections and absorbs

| Older list | Project | Absorb (after a change) |
|---|---|---|
| orchestrator@1 | `projectOrchestrator(store, profile)` | `absorbOrchestrator(store, profile, orch, { newerOnly })` |
| pending@1 | `projectPending(store, profile)` (Pending = a status) | `absorbPending(store, profile, pending, change, { newerOnly })` |
| build-queue@1 | `projectQueue(store, profile)` (the order of epics) | `absorbQueue(store, profile, queue, features)` |

Every writer (`orchestrator.mjs`, `pending.mjs`, `build-queue.mjs`, the console API, MCP tools, plugins) edits a projection
and absorbs it back under one lock (`withStore`). The old files are **read-only exports** regenerated after every write
(`$export` note inside); a file written by something else since the last export is a *foreign write*, absorbed
**newer-only** (adds and updates builds whose `updatedAt` is newer, never reverts or removes) before the next export.

## Versioning

Every write: store `rev` + 1, changed records `rev` + 1, one line in `_claude/builds/journal/<YYYY-MM>.jsonl` with each
changed build before and after (`diffStores`). `builds-store.mjs history <id>` lists revisions, `restore <id> <rev>` puts
a build back (itself a journalled write). Removals are soft; a record missing from a written state is put back deleted.

## Steps view ops (draft until Apply)

`reorder-steps`, `reorder-builds`, `rename-build`, `rename-step`, `rename-profile`, `divide-step`, `harvest` (selected steps
→ 1..N new builds, `origin` kept), `restore-default`. `addDraftOp` tries the whole draft on a copy first, so an op that
cannot apply is refused when added; `applyDraft` / `applyNow` refactor the builds and set status from the steps
(`complete` when every non-skipped step is done, `running` when some are).

## Migration

`migrate(sources)` builds the store once from every older data set (orchestrator wins for steps and status; pending items
merge into their build or become records; repo and hub copies unioned, newer `updatedAt` wins, the other kept in `copies`;
queue epics become `kind: epic`; items only in git history come in **archived** and tagged recovered).
`verifyNothingLost(sources, store)` is the proof, run by the dry run, the real migration and `verify`.

## Deferred

- A `builds-store@1` JSON Schema under `schemas/json/` for editors (the validator above is the contract today).
- Writes do not go through `axhub.memory_write`; the hub sees them through claude-sync (the journal is the history).
