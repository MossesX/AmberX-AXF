<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=9-9 tokens=127 -->
## Status (as of Oct 21 2026)

- **Worker accounts (Nov 7 2026, Opus, `claude/multi-account-headless-workers`, build `multi-account-headless-workers`):** the console stays on one Claude subscription; accounts marked as workers only run headless jobs. `deploy/claude-workers.mjs` routes each job to the least busy worker, moves a run on when a worker hits its limit, and keeps runs and cost per account. Report `_claude/builds/reports/multi-account-headless-workers.md`. <!-- axf-plugin:claude-accounts -->
