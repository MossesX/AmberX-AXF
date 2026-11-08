<!-- memory-chunk@1 source=_claude/THREADS.md lines=145-145 tokens=274 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| AmberX fix: voice loop ("nothing in Inbox" spoken over and over: speech gate, mic held while talking, echo dropped, empty states silent) + screen recording blocked (no FLAG_SECURE; opt-in "Hide sensitive screens from recordings", off by default) (headless, Opus) | stopped (push blocked: VPS GitHub token invalid) | `claude/amberx-fix-loop-securescreen` (local in /root/axf-builds/amberx-fix, merged with origin/main f7170f65 at c9a80e50, retested, not pushed) | — | Built + tested; merged with main and retested (test.mjs 2037/2037, tsc, theme, controls, lifecycle, validate). Both pushes (HEAD:main and the branch) fail: `remote: Invalid username or token`; axHub denied headless; banner item raised. To carry on: new GitHub token → `gh auth login -h github.com`, then in that worktree `git fetch origin && git merge origin/main`, `npx -y tsx apps/amberx-droid/test.mjs`, `git push origin HEAD:main` + push the branch; CI builds the APK. Report `_claude/builds/reports/amberx-fix-loop-securescreen.md` | 2026-10-31 |
