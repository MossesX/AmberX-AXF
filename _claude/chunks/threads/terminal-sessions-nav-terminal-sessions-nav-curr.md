<!-- memory-chunk@1 source=_claude/THREADS.md lines=322-327 tokens=282 -->
### Terminal sessions nav (`terminal-sessions-nav`, Current, Opus) — branch `claude/terminal-sessions-nav`
- Asked (Brett, Nov 3 2026, voice): a collapsible navigation menu on the left of the Terminal listing live sessions, including each session he does with Claude, so he can mirror it and jump in. Build into the existing Terminal plugin; builds on `terminal-vps-host` (#274, merged into this branch).
- Done: s1 rail, s2 mirrors / Jump in / chat feeds / `console_session_note` + rule, s3 live websocket list with timers, sort / search / filter, Recent. Code commit `4d15d019`.
- s4 done: screenshots in the report, UI Review r-20261103-107a9e61 (waiting), PR #286 linked. Left: Brett's UI Review approval; the PR merges after #274 by itself.
- Checks: `python3 <console plugins>/console-terminal/test.py`, `python3 apps/console-web/server/test_mcp_tools.py`, `npx -y tsx framework/spec/check-terminal-nav.mts`, `node framework/cli/check-theme.mjs`, `check-controls.mjs`, `help-coverage.mjs --check`, console `tsc --noEmit`.
- First message: "Check PR #286 (terminal-sessions-nav): CI and the UI Review; fix anything red."
