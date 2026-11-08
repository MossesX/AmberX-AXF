<!-- memory-chunk@1 source=_claude/memory/docs/project-guide.md lines=142-151 tokens=471 -->
## Working with Brett (same in every MossesX repo)

- **Where he works:** mostly from his Android phone (Samsung Galaxy S26 Ultra), often through **Moshi** (mosh) into his Hostinger VPS, where Claude Code runs. Keep replies phone-readable: lead with the result, short paragraphs, no walls of text.
- **Model choice (Oct 27 2026):** no per-build model question any more. The Build orchestrator (`_claude/builds/orchestrator.json`) pins each step to Fable or Opus; a downgrade (Fable → Opus) needs nobody; an **upgrade** (Opus → Fable) needs Brett's approval (Nov 3 2026): stop, `orchestrator.mjs request-upgrade <id> <phase>`, never approve it yourself. One session, no sub-agents. You can't switch models yourself: at a switch, hand him the next phase's brief (`orchestrator.mjs brief <id>`). Rule in `_claude/shared/rules/RULES.md`.
- **`_claude/` + the repo are the shared memory.** Sessions on the phone (Moshi), desktop, web and claude.ai don't share chat history, so anything a future session needs must live in `_claude/` (synced with the hub's `/projects`) or in this repo. Commit and push often with clear messages, and update `_claude/memory/STATUS.md` whenever something meaningful changes.
- **No secrets in the repo:** no tokens, passwords, keys or IPs with credentials. Use environment variables or GitHub Actions secrets.
- **GitHub:** account `MossesX`. A new repo must exist on GitHub before a session can push to it.
- **Server:** a Hostinger VPS running **Coolify**. Coolify's Traefik proxy owns ports 80/443, so new web apps go behind it as Coolify apps (no separate nginx). His domain is `amberxai.com`.
- **axHub:** his connector hub on the VPS (repo `MossesX/axHub`). If the axHub MCP server is configured in this Claude Code install, use its `list_services`, `describe_service` and `call` tools to reach his other services instead of asking him for credentials.
