# VPS sends Shipped features on every merge to main (+ backfill)

Build `vps-sends-shipped-features-every-merge` · branch `claude/vps-sends-shipped-features-every-merge` · PR #709

Brett, Nov 15 2026 12:14 (verbatim): "Why are there no shipped features for the past 2 days. No, the VPS has to send
shipped features as soon as a merge to main succeeds since it now controls the orchestrator"

Status: draft (Phase 2, Opus). Filled in step by step; the final step completes it.

## Root cause (s2)

### What actually ran

`7a6668231` (Nov 9) added one send path: an `afterTick` hook in
`apps/console-web/plugins/build-orchestrator/pipeline.mjs` calls `framework/cli/shipped.mjs shipLanded()` after every
orchestrator tick. That hook has run all along. The pipeline log (`/projects/amberx-axf/_data/pipeline/log.jsonl`)
shows `shipped` events on Nov 13, 14 and 15, and the ledger (`/opt/axf/.axf-console/plugins/shipped-features/ledger.sqlite`,
the same file the console container reads as `/axf/...`) holds 21 manifests for Nov 13, 15 for Nov 14 and 7 for Nov 15.

So the send never stopped completely. It only covers builds the store already counts as landed, and it misses
every landing that the builds store doesn't record that way.

### Why landings were skipped

`shipLanded` asks the **builds store**, not main:

```js
store.builds.filter((b) => SM.isLanded(b) && (b.mergedAt || b.updatedAt) >= from && !b.shipped && !readManifest(b.id))
  .slice(0, 3)
```

Each condition drops a landing shape. Traced against main from Nov 13 00:00 to Brett's message (Nov 15 12:14), using
the merge-watch@1 classifier (`landingsOf`) on main and comparing with the ledger:

| # | Where the send skipped | Landings missed | Examples |
|---|---|---|---|
| 1 | **Main's first parent hides merges.** A `build_land` fast-forward makes the branch's own line main's first parent. Every merge-queue PR merge that landed on main while the branch was open ends up on the **second** parent of the `Merge origin/main into claude/<branch> (build_land)` commit | 8 PR merges between Nov 14 22:33 and Nov 15 11:45, all behind `56503d108` (console-look-becomes-default-axhub-skin) | #687 #693 #696 #689 #324 (no manifest), and #694 #691 #702 (sent only because the reconciler had set `mergedAt` on their store records) |
| 2 | **Not landed by the store's rule.** `isLanded` = `mergedAt` set or `status: complete`. A build that lands one phase by `build_land` (open steps left, status `running`) is never counted as landed; `ship()` doesn't set `mergedAt` while steps are open either | every phase landing | console-look-becomes-default-axhub-skin s1–s6 (Nov 15 11:45, status `running`) |
| 3 | **Not in the store.** Hotfix and direct-launch branches that never had a builds@1 record | 2 PR merges, 1 build_land, 5 batch PRs, direct pushes | #672 hotfix-console-deploy-build-id, orch-build-id-40-chars, batch #548–#552, `9473799f1` |
| 4 | **Already shipped once.** `!b.shipped` skips a build's second landing (a report PR, a merge-main-and-land follow-up) | second landings | #687 (land-batch-merge-main-each-finished's report PR; the build shipped rev 1 at #665) |
| 5 | **Store read during a write.** `builds-store.mjs writeKeepingOwner` writes the ~9.7 MB `store.json` in place; `loadStore()` from the hook does not take the lock, so a read during a write gets truncated JSON and throws. The whole hook fails for that tick | 2 ticks | `hook-failed: Unterminated string in JSON at position 8388090` (Nov 14 23:07), `Unexpected end of JSON input` (Nov 15 15:15) |
| 6 | **Window and cap.** A 3-day window and at most 3 builds per tick. Not a miss on its own, but a landing older than 3 days that falls into 1–4 is never retried | — | — |

By landing path:

- **Merge queue (`push-banner/land/merge-queue.mjs`, PR merges and batches):** sent only when the reconciler later matched the
  PR to a store build (row 1 and 3 otherwise). Batch subjects carry no branch, so a batch PR never maps on its own.
- **Auto-lander / `build_land` fast-forwards:** sent only when the build is `complete` (row 2), and the fast-forward hides every
  PR merge behind it (row 1).
- **Manual GitHub merges and direct pushes:** no path at all (row 3).
- **builds-live:** status-only commits; correctly never shipped.

### Why it looked like nothing shipped

The rows that did go out from Nov 13 to Nov 15 were mostly skin/token builds that landed through the merge queue with a
complete store record. Everything that went through the new paths those two days (the one-at-a-time lander with
build_land fast-forwards, the merge-main-and-land follow-ups, the hotfixes) shipped late or not at all. Brett's
screenshot of the view was not available to this session, so the exact view he checked is not recorded here.

### The fix (s3 onward)

- s3: the existing path stops depending on the store's status. It takes main's landings (first parent **and** the
  main line behind each build_land merge's second parent), reads the store under its lock with a retry on a torn read,
  ships a phase landing and a second landing of the same build as a new rev, and ships store-less landings as unlinked
  manifests. A regression test pins all five cases.
- s4–s9: the merge-watch runner keyed by merge sha replaces `shipLanded` in the tick hook and is called from every landing
  path, with a cron poll as the fallback.
