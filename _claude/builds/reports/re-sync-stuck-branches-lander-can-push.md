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
