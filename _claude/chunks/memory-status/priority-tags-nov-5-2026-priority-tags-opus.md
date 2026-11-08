<!-- memory-chunk@1 source=_claude/memory/STATUS.md tokens=235 -->
## Priority tags (Nov 5 2026, priority-tags, Opus)

Every build has an Urgent / High / Normal / Low tag on every build view; tap or right-click to change it and see what is waiting on it. The agent queue and merge queue follow it; manual moves win. The Build queue screen now shows the real agent queue. Docs `_claude/memory/docs/priority-tags.md`, report `_claude/builds/reports/priority-tags.md`.

**AI keys console-wide (Nov 5 2026, `ai-keys-console-store`):** keys.json is one store for every caller, admins + AXF_TOKEN only (`_admins_only`), per-user files merged at startup into .bak. Brett's 5 keys live in `~/.claude-accounts` (claude-account), not in AI keys: GET /keys lists them as `vpsAccounts` through capability `axf.claude-accounts@1`, POST /active {id: "vps:<name>"} and POST /switch reach them with one held call. Their tokens are not copied because AI keys rotates every refresh token it holds. <!-- axf-plugin:ai-keys -->
