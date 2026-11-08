<!-- memory-chunk@1 source=_claude/THREADS.md tokens=235 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| Asset conformance (Brett Oct 31): handwritten + generated UI code conforms to the hot-swappable asset system; check-theme/check-controls extended to every web UI + Kotlin, file:line + token to use, frozen Android/Patches baseline, axf init gate, briefs carry the rule (headless VPS, Opus) | stopped (push blocked) | `claude/asset-conform` (committed locally in /root/axf-builds/asset-conform) | none yet | Push failed: no GitHub credentials on the VPS (banner item `blocked:push:asset-conform`). To carry on: from a host with a token, `git push origin HEAD:claude/asset-conform` (push banner opens the PR; Brett's Oct 30 rule is PR-only, so prefer that over the brief's direct push to main). Report `_claude/builds/reports/asset-conform.md`. Left: Android Kotlin (286 findings, baselined) once Android is off hold; Patches CSS (14) once unpaused | 2026-10-31 |
