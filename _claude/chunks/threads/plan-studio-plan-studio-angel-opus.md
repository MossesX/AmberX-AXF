<!-- memory-chunk@1 source=_claude/THREADS.md tokens=519 -->
### Plan Studio (`plan-studio`, Angel, Opus)

**Asked (Brett, Oct 30 2026, voice):** a planning studio to store and view every plan, entered by hand with all the info,
categorized; every plugin and app listed with its features checked off as have or planned (full brief: the orchestrator
build `plan-studio` in the Angel profile and `_claude/memory/docs/plan-studio/README.md`). + plain-English AI (14:20) +
AmberX voice planning (14:22).
**Branch `claude/plans`:** all 12 steps built and committed (plugin `apps/console-web/plugins/plan-studio`, seeds, tests, <!-- axf-plugin:plan-studio -->
docs, screenshots, shared rule "put it in a plan for later"). The build sandbox had no GitHub credentials, so the push
was sent as one veto call (vps.run: `git push` from `/root/axf-builds/claude-plans`, `gh pr create`, `gh pr close 159`).
**Left:** (1) if the veto call failed or was denied: from the VPS shell, `cd /root/axf-builds/claude-plans && git push -u
origin claude/plans`, open the PR (title "Plan Studio: every plan in one place + Catalog + plain-English AI + AmberX
voice planning"), close draft PR #159 with the comment "Moved to Plan Studio as the parked plan Docs Studio" (keep the
branch). (2) CI green → merge approval (shared rule). (3) After merge: submit the screenshots to UI Review; `claude-sync
sync` (shared RULES.md changed). (4) The console seeds the three plans into the hub's `_data/plan-studio/` on install
(amberx-selling-it.json is already there).
**Checks:** `python3 apps/console-web/plugins/plan-studio/test.py`, console `npx tsc --noEmit && npx vite build`, <!-- axf-plugin:plan-studio -->
`npx -y tsx apps/amberx-droid/test.mjs`, `node framework/cli/check-theme.mjs`, `check-controls.mjs`,
`check-plugin-pages.mjs`, `plugin-lifecycle.mjs check plan-studio`, `npx -y tsx apps/console-web/scripts/menu-reach.mts`.
**First message:** `Carry on Plan Studio (Angel, orchestrator plan-studio) in AmberX-AXF on branch claude/plans: read
THREADS.md "Plan Studio", push if not pushed, open the PR, close #159 as moved, then merge approval once CI passes.`
