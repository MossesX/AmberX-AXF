# s14 - Run with at least 4 slots in parallel

Brett, Nov 19: this build runs with at least 4 slots in parallel.

## Result

Verified on the VPS on 2026-11-20 at 09:07 UTC. No code change was needed: every limit in the path is already at 4 or higher, and 4 sessions were running at the same time while this step ran.

| Limit | Where | Value |
|---|---|---|
| VPS hard limit (`maxBuilds`) | `<slots dir>/build-limit.json` (build-limit@1, set by Brett only) | 4 |
| Soft cap (`maxAgents`) | `<slots dir>/settings.json` (agent-slots@1, capped at the hard limit) | 4 |
| Heavy lock (`maxHeavy`) | same file | 2 |
| Sessions per account (`parallelPerAccount`) | Pipeline settings | 5 |
| hulu0241 (the account that takes every build) | `pipeline.mjs accounts` | 4/5 running |

`agent-slots.mjs status` while this step ran: `slots 4/4 · hard limit 4/4 · 0 queued`. The four sessions were
`ops-slots-watchdog-cleanup`, and steps s7, s13 and s14 of this build. Steps of one build do run side by side, so the
build is not serialised to one step at a time.

## Notes

- The hard limit can only be raised by Brett (`build-limit.mjs set` refuses without a TTY), so this step did not touch it. 4 meets "at least 4". To run wider: Settings → Plugins → Agent cap in the console, or `node framework/cli/build-limit.mjs set maxBuilds=<n> --by brett` at a terminal. The soft cap follows on its own.
- A session that has finished but whose tmux pane is still closing keeps its soft slot until `closeFinishedAfterSec` (120 s); the hard limit already stops counting it (it showed 3/4 live while the soft cap showed 4/4 for s13). For a short time, that can leave one place idle. Ghost slots are s13's subject (`s13-ghost-build-slots.md`), so this step leaves them alone.
