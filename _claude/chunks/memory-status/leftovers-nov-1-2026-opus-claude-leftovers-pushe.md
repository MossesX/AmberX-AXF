<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=172 -->
## Status (as of Oct 21 2026)

- **Leftovers (Nov 1 2026, Opus, `claude/leftovers`, pushed to main):** closed the last steps of urgent-builds, orch-pending-sync, veto-everywhere, agent-voice, live-key-checks, ui-review, audio-extract and audio-output-recorder (store ticks; most were already on main). New behaviour: the push banner reads GitHub through `axf.github@1` (hub first, local token for writes) and has its own health@1 item `push-banner-github`; auto-merge and Merge hold PRs whose UI Review is waiting / changes / rejected; the axHub web approvals log shows no-approval runs (vps.build_*) inline instead of an empty request page. Report `_claude/builds/reports/leftovers.md`.
