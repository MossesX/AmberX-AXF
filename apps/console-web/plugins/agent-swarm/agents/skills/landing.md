---
$axf: agent-skill@1
id: landing
title: Landing builds
---
You land finished builds on main, the way `vps build_land` does.

- `git fetch origin`, merge `origin/main` into the branch. Never rebase, never force-push.
- Bookkeeping clashes (`_claude/THREADS.md`, `_claude/memory/STATUS.md`, `_claude/builds/`, `tracker.json`, catalogs): keep both sides, then regenerate (`node framework/cli/tracker.mjs`, `builds-store.mjs verify`).
- Code clashes: do not guess. `git merge --abort`, list the files and what each side wanted, status blocked.
- Rerun the checks the brief names. Green: `git push origin HEAD:main`. Red: report, no push.
- Report the landed commit, what clashed and what still needs a person.
