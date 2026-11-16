# Merge watch — every merge to main ships a manifest (merge-watch@1, Nov 15 2026, Fable)

Brett, Nov 15 2026 (verbatim): "Why are there no shipped features for the past 2 days. No, the VPS has to send shipped
features as soon as a merge to main succeeds since it now controls the orchestrator"

Build `vps-sends-shipped-features-every-merge`, step s1: the contract. The watcher that runs it (git walk, tick hook,
CLI, API, backfill) is the next phase; everything it needs to agree on is here.

## Why nothing shipped for two days

`framework/cli/shipped.mjs shipLanded` runs after every orchestrator tick, but it only looks at the **builds store**:
records marked merged / complete in the last three days, three per tick. Main's history tells another story. In the
three days before Nov 15 the first-parent line of main took 1658 commits: 1608 status-only "Builds live: … [skip ci]"
commits (builds-live.mjs) and 50 real ones, which landed in four shapes the store only partly knew about:

| Shape on main | Example subject | What the store knew |
|---|---|---|
| Merge queue PR merge (2 parents) | `Merge pull request #654 from claude/own-token-sets-… (merge queue: tested as queue/pr-654 …)` | `mergedAt` only once the reconciler ran and matched the PR |
| Merge queue batch (2 parents) | `Merge queue batch: #552 on top of #548, #549, #550, #551` | nothing: no branch in the subject |
| build_land fast-forward (2 parents, branch tip) | `Merge origin/main into claude/<branch> (build_land)` | nothing: a fast-forward sets no `mergedAt` |
| Direct push (1 parent) | `Revert "…"`, a hotfix | nothing |

So the source of truth moves: **main's first-parent history**, read by the VPS orchestrator (it controls the
landing line and the tick), with the merge commit sha as the key. The store is still where Brett's words and the build's
steps come from, but it no longer decides *whether* something ships.

## The contract: merge-watch@1

Reference engine `framework/core/merge-watch.mjs` (pure, IO-free; types in `merge-watch.d.mts`). Registry snapshot
`framework/schemas/merge-watch.json`; JSON Schemas `framework/schemas/json/merge-watch.schema.json` and
`merge-watch-entry.schema.json` (written by `axf schemas`). Conformance: `node framework/spec/check-merge-watch.mjs`
(fixture `framework/spec/fixtures/merge-watch.json`, built from main's own Nov 13–15 subjects; CI runs it).

```
merge-watch@1 = {
  $axf, version, repo ('amberx-axf'), ref ('origin/main'), startedFrom (the main sha the watch began at), updatedAt
  lastSeen: { sha, at, checkedAt }          the newest main commit processed; at = its commit time
  entries:  { [merge commit sha]: merge-watch-entry@1 }
}
merge-watch-entry@1 = {
  sha        the landing's commit on main = the key = the manifest's landedCommit = the idempotency key
  base       main just before the landing (first parent of its oldest commit): base..sha is the landing's range
  kind       pr-merge | batch | build-land | direct
  at         commit time (ISO UTC) = mergedAt = landedAt;  subject: the landing commit's subject line
  pr         PR number (0 = none);  branch ('' = unknown);  build: the id the branch names ('' = unknown)
  guess      a build id read from a "<id> sN:" subject prefix; untrusted, used only when the store knows it
  commits    the landing's own commits on main's first-parent line, newest first, the merge commit included
  state      pending | sent | failed | skipped;  reason: '' | status-only | revert | folded;  into: the sha a folded entry joined
  attempts, lastAttemptAt, nextRetryAt, error
  manifest: { id, rev }, sentAt            what went out
  seenAt
}
```

**Idempotency.** One entry per merge commit sha. `advance()` never recreates a sha it has; `sent` is final. A build that
lands twice (two merges) gets two entries and two manifest revs (`sm-<build>` rev 1, rev 2), which is what
shipped-manifest@1 already does. Sending is at-least-once at the transport, exactly-once by sha here.

**Retries.** `markFailed` backs off 1, 5, 15, 60, 240, 1440 minutes (`RETRY_MINUTES`); after `MAX_ATTEMPTS` (8) the entry
stays `failed` with no `nextRetryAt` and waits for a hand (`reset`): that is the systems check banner item of the next
phase, with the sha, the build and the last error. `due(state, now)` is what a tick sends, oldest first.

**Hold.** A fresh plain commit on main's tip (a direct landing seen before its build_land merge arrived) is held
`HOLD_MINUTES` (10). If the next tick brings the build_land merge of its branch, the merge claims it (`folded`, with
`into`), so the branch ships once, as one landing. Old direct commits (a backfill) are not held.

**Prune.** `prune()` drops `sent` / `skipped` entries older than `KEEP_DAYS` (30). Pending and failed stay however old.

## How main's first-parent line becomes landings

`landingsOf(commits)` takes what `git rev-list --first-parent --parents --format=… <lastSeen>..<ref>` prints (newest
first) and classifies each commit by subject and parent count (`classifyCommit`; patterns in `SUBJECTS`, exported in the
registry so other ports read the same ones):

- **status-only → skipped.** `Builds live: …` and the merge queue's `Merge queue: main's status commits …` fold. Never
  shipped, but recorded, so a walk can prove it saw them.
- **revert → skipped.** `Revert "…"`. The ledger has no un-ship; the entry is there for the record.
- **pr-merge.** `Merge pull request #N from <branch>`; PR and branch from the subject, build = branch minus `claude/`.
  A squash merge `… (#N)` with one parent is a pr-merge with only the PR. The branch's work is on the second parent:
  the host reads files as `base..sha`.
- **batch.** `Merge queue batch: #N on top of …`: one landing per PR, PR only.
- **build-land.** `Merge origin/main into <branch> (build_land)`: main was fast-forwarded to the branch tip, so the
  branch's own commits sit right before it on the first-parent line (the fast-forward is atomic; a walk from
  `lastSeen` never crosses into them from another landing) and belong to it. Two build_land merges of the same branch
  back to back are one landing, keyed by the newer.
- **direct.** Any other plain commit. A run of them with no build_land merge after it becomes direct landings, one per
  consecutive subject-prefix group, keyed by the newest commit; `guess` carries the prefix.

## How a landing becomes a shipped-manifest@1

`toManifestOverlay(entry, { repo, known, byPr })` is the partial manifest the host hands `shipped.mjs ship(id, { manifest })`;
the rest is gathered as today (store record, git, headless meters, UI Review, report).

| shipped-manifest@1 field | From |
|---|---|
| `build.id` | the branch minus `claude/` (trusted, build-id@1 branches are made from the id); else the store's build for the PR (`byPr`); else the subject prefix when the store knows it (`known`); else `main-<sha9>` (a store-less direct landing; its title is the subject) |
| `pr` | `{ repo, number }` from the subject |
| `branch` | from the subject |
| `landedCommit` | the entry's sha |
| `commits` | the entry's commits (the host adds the branch's own, from git) |
| `mergedAt`, `landedAt` | the entry's `at` (the landing commit's time; the fast-forward and the merge are the same instant on main) |
| `files` | git: names changed in `base..sha` (every kind, including the PR merge whose work is on the second parent) |
| `areas` | shipped-manifest `areasOf(files)` |
| `tests`, `open` | the build report, `_claude/builds/reports/<build>.md`, which is also `report` |
| `said` | **never from the overlay**: Brett's words come from the builds@1 record (`origin`, verbatim). Only a build the store never had falls back to `fallbackSaid(entry)`: the commit subjects, `verbatim: false`, `source: 'git'` |

`summaryOf(state, now)` gives the counts (pending / sent / failed / skipped), what is due, the oldest pending landing,
the failed list with `gaveUp`, and the last send time: the one shape the console, the CLI, MCP, voice and the systems
check banner read.

## Where the state lives: one path resolver

`framework/cli/merge-watch-files.mjs` is the only module that builds the path. State file: `<data root>/_claude/builds/merge-watch/state.json`.
Data root, first match wins:

0. `AXF_MERGE_WATCH_DATA` — exactly that folder: the runner's data in a container (axf-molly)
1. `AXF_MERGE_WATCH_DIR` — exactly that folder (tests, another host)
2. `AXF_BUILDS_STORE=<file>` — a scratch store: `<file minus .json>.merge-watch/` next to it (tests)
3. `AXF_DATA_DIR` — `<that>/_claude/builds/merge-watch` (`off` / empty = the repo). **This is the axf-data switch:**
   when the orchestrator moves into axf-molly, set `AXF_DATA_DIR` to its data root and nothing else changes
4. hub — `/projects/<project>/_data/…` (persist.mjs `persistRoot`: the axhub-projects volume the console has today)
5. repo — the checkout itself (laptops, CI); `_claude/builds/merge-watch/` is git-ignored, the state is runtime data

`readState` normalises (merge-watch@1 or null), `writeState` is atomic, `whereIs` says which rule won (for `status`).
The shipped manifests themselves stay where they are (`_claude/builds/shipped/<build>.json`, committed) and still go
through the builds store, so build-hook@1 `shipped` keeps firing and the ledger needs no change.

## Next phase (not in s1)

- `framework/cli/merge-watch.mjs`: `tick` (walk `lastSeen..origin/main`, `advance`, send what is `due` through
  `shipped.mjs ship`, `markSent` / `markFailed`, prune), `status`, `backfill --since` (start the walk at an older sha),
  `reset <sha>`, `--json` on all; the orchestrator's `afterTick` hook calls `tick` instead of `shipLanded`, right after the
  landing line reports a merge, so the manifest goes out in the same tick the merge lands.
- API: the plugin command / REST / MCP / voice views of `summaryOf`, `reset`, `backfill`; a systems check banner item for
  `failed` entries that gave up; a deep link to the Shipped features grid filtered on the landing.
- The Kotlin twin is deferred (framework/spec/PORTING.md).

## Moving with the orchestrator (s10)

The runner (`framework/cli/merge-watch.mjs` and `framework/cli/merge-watch/`) reads nothing repo-relative beyond:
`AXF_MERGE_WATCH_DATA` (state, tick.lock, alert.json, github-cache.json, log.jsonl), `AXF_MERGE_WATCH_REPO` (the clone
git runs in and reports are read from), `AXF_SHIPPED_DIR` (sidecars), `AXF_SHIPPED_FEATURES_DIR` (ledger, read-only) and
`AXF_MERGE_WATCH_SEND` (`local,api` on the VPS; `api` with `AXF_CONSOLE_URL` + `AXF_TOKEN` in a container with no store).
The axf-molly job is `deploy/molly/merge-watch.entry.mjs` (`{ id, everySec, run({ env, shadow }) }`; shadow = a dry tick).
When molly takes the lease, run it there and remove the VPS cron `axf-merge-watch`. A note sits on
move-build-orchestrator-to-axhub.
