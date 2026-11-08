<!-- memory-chunk@1 source=_claude/THREADS.md lines=74-74 tokens=216 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Merge queue: test once, never twice (Current `merge-queue`, Opus, 6 steps; Brett Nov 4 voice: "We're paying to do these CI checks twice."; agent Landin' Lenny): GitHub's merge queue needs an org-owned repo, so ours lives in auto-land (`push-banner/land/merge-queue.mjs`, zero tokens): ready PRs stacked on `queue/pr-<n>` branches, tested once, green head merges with no retest, red kicked out with a reason and the rest rebuilt; CI scope (`framework/cli/ci-scope.mjs`): path filters per job + app build, light PR checks while the queue is on, main skips what the queue ran; Merge queue view + banner chip + REST/MCP/CLI | review (s1–s5 done; PR + live round left; UI Review r-20261104-d7a77e5c) | `claude/merge-queue` | – | Report `_claude/builds/reports/merge-queue.md` | 2026-11-04 |
