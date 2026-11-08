<!-- memory-chunk@1 source=_claude/THREADS.md lines=133-133 tokens=245 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| UI Review → Screenshots tab (headless VPS, Opus): ad-hoc screenshots store (`ui-screenshot@1`), intake API (JSON/multipart, token) + `axf shot` CLI + Upload, DataGrid grouped by app/screen/source/day, thumbnails, full-screen viewer with before/after slider, copy link, delete, Send to review; `Breakroom check:` items migrate out of the review queue; RULES + build briefs say use `axf shot` | stopped (built + tested, push blocked: VPS GitHub token 401) | `claude/shots-tab` (local in /root/axf-builds/shots-tab, merged with origin/main e46b8079, not pushed) | — | Also fixed main's red theme + output-recorder lifecycle checks. To carry on: new token → console Keys, then in that worktree `git fetch origin && git merge origin/main`, rerun ui-review tests + check-theme, `git push origin HEAD:main`. Banner `blocked:github-token-shots-tab`. Report `_claude/builds/reports/shots-tab.md` | 2026-11-01 |
