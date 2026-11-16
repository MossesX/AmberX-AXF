# Re-sync stuck branches so the lander can push them

Build `re-sync-stuck-branches-lander-can-push` (split from `get-main-green-unblock-lander-land-axf`).

## s1 inventory (before, 2026-11-16, after `git fetch origin`)

| Branch | Local | Origin | Local ahead / behind origin | Ahead / behind main | PR |
|---|---|---|---|---|---|
| claude/server-gate-one-session-per-build-no | be75e0ae8 | 949c25d49 | 1 / 2740 | 6 / 3707 | #610 open |
| claude/one-source-truth-console-shows-only-what | dc873adac | a7febca2e | 1 / 1825 | 5 / 2806 | #598 open |
| claude/console-axhub-retry-failed-calls | da3e3477b | ba0c8fa31 | 1 / 1898 | 7 / 2807 | #589 open |
| claude/demo-video-series-three-minute-browser | 388338407 | 6936a3fc8 | 1 / 2 | 33 / 40 | #667 open |
| claude/merge-main-land-one-source-truth-console (stray) | dbc20af28 | none | n/a | 0 / 984 | none |
| land-native-bridge-mic (stray) | 2259d0b69 | none | n/a | 48 / 994 | none |
| claude/auto-lander-controls-in-the-gate-plugin | 5fde0e9bd | 5fde0e9bd | 0 / 0 | 16 / 667 | #705 open |

Why the four were stuck: each has exactly one local-only commit, "commit synced files left in the worktree (auto-land)",
which only touches builds-store snapshots (`_claude/builds/store.json`, `orchestrator.json`, `origins.json`, `journal/*.jsonl`).
Origin moved on, so the lander's plain push was rejected as non-fast-forward.

Out of scope, not touched: `claude/axf-data-postgres-real-tables-own`, `claude/data-container-axf-data-holds-all`.

## Re-syncs (merge origin into local, both sides kept, plain push)

- s2 `claude/server-gate-one-session-per-build-no`: merged origin 949c25d49 into local be75e0ae8 → 8b5495bd1; builds-store files resolved by the `axf-builds` merge driver, no manual conflicts; pushed fast-forward.
- s3 `claude/one-source-truth-console-shows-only-what`: merged origin a7febca2e into local dc873adac → eccfe754a; merge driver resolved the builds-store files; pushed fast-forward.
- s4 `claude/console-axhub-retry-failed-calls`: merged origin ba0c8fa31 into local da3e3477b → e68f9aa05; merge driver resolved the builds-store files; pushed fast-forward.
- s5 `claude/demo-video-series-three-minute-browser`: merged origin 6936a3fc8 into local 388338407 → 5e77e6939; merge driver resolved the builds-store files; pushed fast-forward.

## Strays dropped (s6)

- `claude/merge-main-land-one-source-truth-console` (dbc20af28): `git cherry origin/main` shows no commit missing from main. Deleted locally; it never existed on origin. Its old worktree (`/root/axf-builds/merge-main-land-one-source-truth-console`) stays as it is, detached at a7febca2e, with an expired Nov 14 build lock; it only holds builds-store snapshots and logs.
- `land-native-bridge-mic` (2259d0b69): 30 commits are not patch-equivalent on main, but every one is on its real build branch on origin (17 on `claude/console-android-app-thin-webview-wrapper`, 12 on `claude/console-app-part-3-native-bridge-mic`, 1 on `claude/console-app-part-2-native-floating-2`). The worktree was clean, so it was removed and the branch deleted locally; it never existed on origin.
- Backup tags (local, on the VPS repo): `backup/stray/land-native-bridge-mic`, `backup/stray/merge-main-land-one-source-truth-console`.
- No remote delete was needed, so no GitHub App veto call was made.

## auto-lander-controls-in-the-gate-plugin

- s7: the worktree had no tracked changes left at 5fde0e9bd (local == origin); only the dispatcher's untracked session files (`.axf-brief.md`, `.axf-look-follow.log`, `<build>.jsonl/.log`), which every build worktree carries. Nothing to commit, nothing to stash.
- s8: merged origin/main into the branch (5fde0e9bd → 61013c9db). `framework/cli/axf.mjs` conflict resolved keeping both sides: main's `axf voice …` route first, then the branch's plugin-declared CLI words (`plugin.json` `cli`, e.g. `axf lander status`); both commands answer. `apps/console-web/src/control/inventory.json` regenerated with `apps/console-web/scripts/control-inventory.mjs` (`--check` current). Checks: `node --check framework/cli/axf.mjs`, gate `test.mjs` 21/21, gate `test.build-rules.mjs` 7/7, `plugin-lifecycle check gate` clean, `check-console-control` clean. Pushed fast-forward.

## Lander handoff (s9)

All five builds re-linked with `builds-live.mjs link <id> --branch claude/<id> --pr <n>` (they were already linked; status `built`): #610, #598, #589, #667, #705, all open.
#667 (demo video series) was still a draft although every step of its build is ticked; the lander skips drafts, so it was marked ready for review.
`land.mjs queue list` lists all five; none is queued yet only because CI on the new heads is still running or hasn't started. The lander adds each one by itself once its checks are green. Nothing was added or merged by hand.

## After (s10)

| Branch | Before (local / origin) | After (local = origin) |
|---|---|---|
| claude/server-gate-one-session-per-build-no | be75e0ae8 / 949c25d49 | 8b5495bd1 |
| claude/one-source-truth-console-shows-only-what | dc873adac / a7febca2e | eccfe754a |
| claude/console-axhub-retry-failed-calls | da3e3477b / ba0c8fa31 | e68f9aa05 |
| claude/demo-video-series-three-minute-browser | 388338407 / 6936a3fc8 | 5e77e6939 |
| claude/auto-lander-controls-in-the-gate-plugin | 5fde0e9bd / 5fde0e9bd | 61013c9db |

- `git ls-remote origin` matches the local head for all five branches; both strays are gone locally and were never on origin.
- `node framework/cli/builds-store.mjs verify`: valid builds@1, 948 records.
- No force push anywhere. Every merge kept both sides' commits.

## API

No UI was added or changed. The branches reach main through the auto-lander as before: `land.mjs queue list|…` (CLI), MCP `push_banner_mergequeue_*`, the console REST merge-queue routes, and voice (AmberX) through the same console actions.

## Left open

- `/root/axf-builds/merge-main-land-one-source-truth-console`: an old worktree, detached at a7febca2e, with an expired Nov 14 build lock and only builds-store snapshots in it. It is harmless and was left alone; remove it with `git worktree remove --force` when convenient.
- The five PRs still need green CI on their new heads before the lander queues them. If one goes red, the lander's own banner shows it.
