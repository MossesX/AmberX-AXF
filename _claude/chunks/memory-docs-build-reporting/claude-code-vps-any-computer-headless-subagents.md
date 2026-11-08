<!-- memory-chunk@1 source=_claude/memory/docs/build-reporting.md lines=12-38 tokens=452 -->
## Claude Code (VPS, any computer, headless, subagents)

One line per machine (needs Node 18+ and a checkout of AmberX-AXF; the hub token from `claude-sync login`, or
`AXHUB_TOKEN`, lets it write to axHub from anywhere):

```bash
node ~/AmberX-AXF/apps/console-web/plugins/codebase-changes/changes.mjs hooks install   # user settings: every project (axf-plugin:codebase-changes)
```

`deploy/claude-pick.sh --install` runs it too. The hooks (`~/.claude/settings.json`, all projects) open an entry when
a prompt asks for a change, send the current activity (throttled, one write per 30 s) and subagent starts/stops as live
steps, mark "waiting for you", and on Stop / SessionEnd fill in the **actual tokens and cost** from the session
transcript (prices: `framework/schemas/model-pricing.json`). They never block Claude Code. Then, before building:

```bash
C=~/AmberX-AXF/apps/console-web/plugins/codebase-changes/changes.mjs   # (axf-plugin:codebase-changes)
node $C update <id> --ref pending:lib-clone --model opus --estimate-min 90 --areas "apps/console-web/plugins/x,framework/core/y" --branch feat/x
node $C step <id> "Server routes" --state running      # … --state done
node $C result <id> --state done --summary "…" --branch feat/x --commit abc1234 --link pr=https://github.com/…
```

Where a run writes: `AXF_CHANGES_DIR` → `/projects` (console container) → **axHub over MCP** (hub token) → console API
(`AXF_TOKEN`) → `--to-repo` → local queue (sent on later). Console launches ("Start build now") set
`AXF_SURFACE=console-launch AXF_ADOPT_CHANGE=<id>`: the session reports on the entry the console opened. A session
started under another one sets `AXF_PARENT_CHANGE=<id>` so its own entry shows under it. Subagents (Task tool) show as
running child steps of their session's entry by themselves.
