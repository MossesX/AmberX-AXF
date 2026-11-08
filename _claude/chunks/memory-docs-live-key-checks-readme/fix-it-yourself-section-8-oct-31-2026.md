<!-- memory-chunk@1 source=_claude/memory/docs/live-key-checks/README.md lines=34-51 tokens=392 -->
## Fix it yourself (section 8, Oct 31 2026)
- Rule (shared RULES.md, near the top, and CLAUDE.md): fix what the tools can fix, as a veto call with a plain reason,
  then tell Brett; ask only for his hands or a real choice, and then as a banner item with the steps.
- health@1 auto-fix: run first, amber while fixing, red only if still broken; per check on / ask first / off; history +
  change log. Auto-fixes: dead GitHub token → hub route, disk → Docker clean-up (veto call); stuck builds → stalled is ask-first by default (closing entries is Brett's call).
- github@1: framework `axf_server/github_hub.py` (`HubGitHubClient`, `ROUTES`, `HubLink`) + `axf.github@1` in the
  systems check. Hub first, local fallback (or reversed). Only read-only hub tools are routed: axHub's github service
  has no merge or branch-delete tool and its writes need approval, so auto-merge and branch cleanup still need a working
  local token until the hub adds them (axHub follow-up).
- Screenshots (scratch console, no hub token): Settings → Systems check → Fix it yourself.

  | phone | desktop |
  |---|---|
  | ![fix it yourself phone](shots/fix-it-yourself-phone.png) | ![fix it yourself desktop](shots/fix-it-yourself-desktop.png) |
- Tests: framework `axf_server/test.py` 390 (20 for github_hub, fake hub + fake GitHub: routes, typed args, pagination
  trailer → Link, hub down / hub token refused / hub's GitHub 401 / approval-held → local, 404 stands, local-first
  401 → hub), systems-check `test.py` 215 (31 new: auto-fix flows, veto parsing, github@1 with a fake hub).
