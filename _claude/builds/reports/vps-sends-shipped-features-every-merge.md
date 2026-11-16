# VPS sends Shipped features on every merge to main (+ backfill)

Build `vps-sends-shipped-features-every-merge` · branch `claude/vps-sends-shipped-features-every-merge` · PR #709

Brett, Nov 15 2026 12:14 (verbatim): "Why are there no shipped features for the past 2 days. No, the VPS has to send
shipped features as soon as a merge to main succeeds since it now controls the orchestrator"

Status: Phase 2 (Opus) done, Nov 16 2026. PR #709.

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

## Fix at the root (s3)

- `framework/cli/merge-watch/walk.mjs`: main's landings from git. The first-parent line plus, for every merge of main
  on it (`(build_land)`, `Merge origin/main …`), the main line behind its second parent (`--first-parent p2 ^p1`,
  recursively, depth 4). Each line goes through `landingsOf` on its own. A branch merging another branch is not followed.
- `framework/cli/shipped.mjs shipLanded`: ships every landing in the window that names a build (branch, PR via the store,
  known subject prefix), ten per tick, oldest first, with the merge-watch overlay (landedCommit = merge sha, PR,
  branch, commits, mergedAt / landedAt). Store status no longer gates it. `sentFor` = a manifest for the build names the
  sha or one of its commits, the PR, or a landing at or after this one (the sidecar keeps only the latest rev); an old
  manifest with no landedCommit and no PR matches within 30 minutes. Landings that name no build (`main-<sha9>`) are left
  to the merge-watch runner. `landed --dry` shows what would go out.
- `framework/cli/builds-store.mjs writeKeepingOwner`: atomic write (temp file with the old owner and mode, then rename;
  in place only when the folder refuses a new file), so an unlocked read never sees a torn store.
- Regression test `framework/cli/merge-watch/test.mjs` (CI): a throwaway repo with a PR merge hidden behind a build_land
  fast-forward, a phase landing of a running build, a store-less hotfix PR, a second landing (rev 2), an already
  shipped landing that must not go out again, and a second run that sends nothing.

Dry run on the VPS (Nov 16, 4 days): 20 landings due, including #687 #693 #696 #689 #324 #672, the
console-look-becomes-default-axhub-skin phase landing and orch-build-id-40-chars. The real send is the backfill (s14).

## Backfill dry run (s13)

`node framework/cli/merge-watch.mjs backfill --since 2026-11-13 --dry` against the VPS data (sidecars in /opt/axf, the ledger),
Nov 16 2026: 64 landings on main since Nov 13 (status-only commits never count). 21 to send, 30 in the sidecar, 2 in the ledger, 11 a sync inside a stack: its PR ships it.
No sha twice, no unlinked landing. Every merge the step names is covered: #687 #693 #696 #689 #324 #618 and the
console-look-becomes-default-axhub-skin phase landing go out; #694 #691 #702 #647 #648 #590 #641 #652 #657 #654 already
have their manifest. #548–#552 are second PRs of five builds that landed by squash at 06:14 on Nov 13: rev 2 of the same
manifest id, not new rows.

The dry run found two more shapes the walk now covers:

- **Stacked PRs.** #647 #648 #590 #618 merged into chained land/* branches (own-tokens ← token-reg ← anim ← override ←
  axhub-only ← light-dark ← skin-config ← skins-plugin) that landed as one PR. Each `Merge branch 'land/…'` behind a PR
  merge's second parent is a landing of its own when GitHub names it a PR's merge_commit_sha (search + pulls/{n}); the
  other syncs inside the stack fold into the stack's PR (11 here).
- **Deep chains.** Stacks recurse up to 16 branches deep.

| Landed (UTC) | Kind | PR | Build | Merge sha | Manifest |
|---|---|---|---|---|---|
| 2026-11-13 01:09 | pr-merge | #534 | hotfix-launcher-splitter | 0f67f0d7f | new |
| 2026-11-13 06:27 | batch | #548 | amberx-approval-pop-up-not-showing-only-the-android-notification | 9a7a04f93 | rev 2 |
| 2026-11-13 06:27 | batch | #549 | one-account-picker-choose-the-single-claude-account-the-console-and-vps-builds | 4d917727c | rev 2 |
| 2026-11-13 06:27 | batch | #550 | everything-on-tokens-before-skins-fix-the-27-open-check-theme-problems-and-the | d342201c4 | rev 2 |
| 2026-11-13 06:27 | batch | #551 | full-voice-and-ai-control-of-everything-in-the-console-before-the-android-app | 8ea73d3c8 | rev 2 |
| 2026-11-13 06:28 | batch | #552 | 10-minute-steps-the-splitter-cuts-every-build-into-steps-of-10-minutes-or-less | 4dbbdd96f | rev 2 |
| 2026-11-13 17:20 | build-land |  | overlay-float | 5497cc657 | new |
| 2026-11-13 17:20 | build-land |  | overlay-pages | 038e4fb02 | new |
| 2026-11-13 17:22 | build-land |  | orch-build-id-40-chars | f9391678a | new |
| 2026-11-13 18:42 | build-land |  | notes-tasks-r2-land | 5b8fb0e4c | new |
| 2026-11-13 18:54 | build-land |  | context-menu-console-settings | 05d23b6f3 | new |
| 2026-11-13 19:28 | build-land |  | test-project-seed | ea98536da | new |
| 2026-11-14 14:39 | pr-merge | #672 | hotfix-console-deploy-build-id | 8ee0adce5 | new |
| 2026-11-14 19:11 | direct | #618 | console-skin-axhub-only | c1a92b67b | new |
| 2026-11-15 04:00 | pr-merge | #683 | per-toolbar-settings-fix-failing-chrome | a5e2f7640 | rev 2 |
| 2026-11-15 04:00 | pr-merge | #687 | land-batch-merge-main-each-finished | e35574224 | rev 2 |
| 2026-11-15 07:36 | pr-merge | #693 | merge-main-land-console-axhub-retry | 7801e65f3 | new |
| 2026-11-15 07:51 | pr-merge | #696 | land-all-skin-builds | fc744e5e3 | new |
| 2026-11-15 08:06 | pr-merge | #689 | merge-main-land-change-to-move-amberx | 35cfd9eae | new |
| 2026-11-15 10:06 | pr-merge | #324 | urgent-land-gizmo-chat-report | 32e55adee | new |
| 2026-11-15 11:45 | build-land |  | console-look-becomes-default-axhub-skin | 56503d108 | new |

## Backfill for real (s14)

`merge-watch.mjs backfill --since 2026-11-13` on Nov 16 at 14:07 UTC, sent through the console's ledger API (transport
`console`: `docker exec axf-console`, production `shipped.mjs ship`): **21 merges sent, 0 failed** (#324 first as a
single `send`, then 20). All 21 are in the ledger (`manifests.landed_commit`), and builds-live published the 21 sidecars to
main byte for byte (merged into this branch). The watch's state now lives at
`/projects/amberx-axf/_data/_claude/builds/merge-watch/state.json` with lastSeen at main's tip: from here every tick
takes only new merges.

### Second cause found while checking: the manifest list answered 500

`GET /api/plugins/shipped-features/manifests` failed with `JSONDecodeError: Unterminated string … char 130910`.
`ledger/ledger.mjs` called `process.exit()` before stdout drained, so a piped answer stopped at 65,536 bytes; the manifest
list is ~309 KB since the Nov 12 backfill (324 manifests) pushed it past 64 KB. Every surface that lists or searches
manifests through that CLI (the list, MCP and voice "what shipped") got an error or nothing. Fix: exit after a flushed
write; plugin test `the ledger CLI lets stdout drain…` seeds 120 manifests and parses the whole piped answer.
The GitHub ETag cache keeps only the fields the watch reads (716 KB → 18 KB).

## Result

- **Root cause:** the one send path (`shipLanded`, after every orchestrator tick) asked the builds store what had landed,
  not main. It missed PR merges hidden behind a build_land fast-forward, phase landings, store-less hotfixes, second
  landings and stacked PRs, and lost ticks to torn store reads. Separately, `GET /manifests` answered 500 because the
  ledger CLI's piped output was cut at 64 KB.
- **Fix:** the VPS watches main (merge-watch@1). Every landing, keyed by merge sha, is sent once, retried with backoff,
  and raises a systems check item plus one AmberX alert after 3 failures. The store write is atomic, the ledger CLI drains
  stdout, and `shipLanded` reads main too until the watch has state.
- **Backfill:** 21 merges since Nov 13 sent, 0 failed. 32 already had a manifest, 11 stack syncs folded. All 21 are in
  the ledger and their sidecars are on main.

## How each surface reaches it

| Surface | Merge watch | One feature store |
|---|---|---|
| Deep link | `console_show view:gate/tab:gate.tabs=build-rules` row `shipped-features` (`#/gate`); systems check item `shipped-merge-watch` links there | Shipped features page; Gate & rules Pending features tab (its build) |
| REST (`/api/plugins/shipped-features/…`) | `GET merge-watch`, `GET merge-watch/list`, `POST merge-watch/send` / `retry` / `backfill` / `switch` / `tick` | `GET builds?state=&build=&pr=&since=`, `GET builds/{id\|PR\|sha}` |
| MCP (plugin-commands@1) | `features_merge_watch_status`, `_list`, `_send`, `_retry`, `_backfill`, `_switch`, `_tick` | `features_list`, `features_get` |
| CLI | `axf merge-watch tick\|status\|send <sha>\|backfill --since\|retry\|on\|off\|list` | `node framework/cli/feature-store.mjs list\|get`, `axf shipped-features features-list` |
| Voice (AmberX) | the same commands' phrases: "are merges reaching shipped features", "retry the shipped features sends", "backfill shipped features since Friday", "turn the merge watch off" | "what is pending", "what shipped since Monday", "where is PR 711" |

## Checks run (s17)

check-theme, check-controls, check-plugin-pages (the Gate page head had no description; main's CI would fail on it, one
line added), check-console-control (inventory regenerated), check-merge-watch (40), merge-watch/test.mjs (26),
check-shipped-manifest (35), shipped-features test.mjs (11) and test.py (26), notify-control (133), pipeline (52),
auto-land (110), merge queue (18), plugin-commands (41), check-plugin-commands (59), check-plugin-catalog (55), gate (21 + 7),
check-build-rules (27), check-mcp (210), check-console-control.mts (290), check-help (272), glossary-index,
plugin-lifecycle check (clean), `axf schemas` (no drift). Node 22 where the check needs `node:sqlite`.

## Open

- The Gate & rules plugin shows the merge watch in its 'shipped-features' build rule and lists the feature store in a
  Pending features tab: that UI is the Gate plugin's own build; the API it needs is here (GATE.md → features.*).
- The optional push webhook route was not added: the cron poll every minute and the in-process triggers cover it.
- The axf-molly job is a stub (`deploy/molly/merge-watch.entry.mjs`) until molly's job API is in this repo.
- Kotlin twin of merge-watch@1 deferred (framework/spec/PORTING.md).
