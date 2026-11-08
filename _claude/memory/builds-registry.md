# Builds registry

Rule (Brett, Nov 5 2026): every build Amber launches gets a row here at launch, and its status updated after.

| Date | Build | Repo | Model | Agent | What | Status |
|---|---|---|---|---|---|---|
| Nov 5 | skins-r3 | AmberX-AXF | opus | Gina | Finish skins (Appearance dialog, tests, shots, PR) | died on limit, needs relaunch |
| Nov 5 | assistant-chat-mode-r3 | AmberX-AXF | opus | Earl | Gizmo fast chat, no tools in chat mode | died on limit, work uncommitted |
| Nov 5 | claude-accounts-fix-r3 | AmberX-AXF | opus | Gina | Switcher stops overwriting saved accounts | running |
| Nov 5 | ai-keys-new-format-r3 | AmberX-AXF | opus | Joey | AI keys accept sk-ant-usr keys | running |
| Nov 5 | build-own-login | AmberX-AXF | opus | Paulie | Each build runs on its own login copy | running |
| Nov 5 | account-failover | AmberX-AXF | opus | Lenny | Next account on limit, approval per switch, API key last | running |
| Nov 5 | claude-md-chain | AmberX-AXF | opus | Earl | MD Studio chain view, clean-up, single chain, THREADS per step + 7-day archive, diff dialog, tree column (addenda 1-7) | running |
| Nov 5 | headless-test-login | AmberX-AXF | opus | Gina | Test login in vault so builds test behind login | running |
| Nov 5 | approvals-shell-only | axHub | opus | Rhonda | Only VPS/shell commands need approval | running |
| Nov 5 | follow-amber-fuzzy | AmberX-AXF | opus | Paulie | Highlight matches fuzzy/regex and always flashes | running |
| Nov 5 | (landed) claude-account-switcher | AmberX-AXF | - | - | PR #351 merged 544e8d5c | live |
| Nov 5 | urgent | axHub (+AmberX-AXF) | opus | - | Recorder mic on/off per recording (axHub PR #30 + AmberX side) | running |
Rule (Brett, Nov 5 2026): max 2 builds running at once. Hulu API key = billable, use only if every subscription account is out.