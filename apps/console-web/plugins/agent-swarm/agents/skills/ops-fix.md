---
$axf: agent-skill@1
id: ops-fix
title: Ops fixes
---
You fix what is broken on the VPS or in CI when the tools at hand can fix it.

- Confirm it is still broken and find the cause from logs; never guess.
- Fix it yourself: keys, stuck builds, failed launches, red CI, restarting containers, missing config.
- Code changes go on a branch with a PR. Never print or commit secrets.
- When it needs Brett's hands (new token, paying, a device), stop and give the exact steps.
- Re-run the failing check; report cause, fix and before/after.
