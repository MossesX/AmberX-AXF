# Gate & rules (console plugin)

`ai.amberx.axf.console.gate` · built on Opus (Nov 15 2026, build `gate-rules-plugin-in-the-console`;
Brett: "Where is the gate and rules plugin, open it on my screen.").

The gate a PR must pass before it lands (gate-rules@1) and the auto-lander that lands it, in one place:
Builds → **Gate & rules** (`view:gate`), with three tabs (framework TabGroup `gate.tabs`):

- **Rules**: every gate rule with its on/off switch, severity and settings; Reset to defaults (confirm); Check a PR.
- **Auto-lander**: the one mode switch **Merge queue** (on = PRs go through the stacked merge queue and the
  one-at-a-time lander is off; off, the default = the lander lands each finished build one at a time: merge main
  first, fix clashes, then land), status, waiting PRs with the rule that holds each and why, last runs, Land now,
  Pause and Resume.
- **History**: every rule change and lander action, append-only (who, when, before / after).

Contract: `framework/spec/GATE.md`. Engine: `framework/core/gate-rules.mjs` (pure). This folder adds the IO:

| File | What |
| --- | --- |
| `gate-store.mjs` | the store adapter: rule set, lander config, queue and run files behind one interface (a later axf-molly backend replaces only this file and `lander.mjs`) |
| `lander.mjs` | the lander adapter: mode switch, status, waiting, runs, land now, pause, resume |
| `history.mjs` | append-only JSONL history with filters |
| `gate.mjs` | the CLI (`axf gate …`) and the JSON entry the server routes call |
| `server/routes.py` | REST `/api/plugins/gate/…` (MCP `gate_*` / `lander_*` through plugin-commands) |
| `web/` | GateView and its tabs |

## API (every surface the same calls)
- REST `/api/plugins/gate/…` (server/routes.py docstring lists every route).
- MCP on the console's `/mcp` through plugin-commands: `gate_rules_list|get|set|toggle|reset`, `gate_check_pr`,
  `gate_history`, `gate_settings(_set)`, `lander_status|waiting|runs|mode|mode_set|land_now|pause|resume` (names fixed
  by GATE.md through `commands.items[].tool`). axHub reaches them through the console's `/mcp`; its policy follows the
  annotations (reads run at once, writes are veto calls, Reset and Land now also ask for the gate's confirm token).
- CLI `axf gate rules|check|history|lander|settings …` (gate.mjs, plugin.json `cli`), and every command id through
  plugin-commands (`axf gate rules-list --json`).
- Voice / console actions: `gate.open[:tab]`, `gate.rule:<id>[:on|off]`, `lander.land-now:<pr>` (confirms first),
  `lander.pause[:why]`, `lander.resume`.

## Server auto-lander (auto-lander@1)
The VPS runner that fixes and lands finished builds by itself (Brett, Nov 16 2026: "Make the server do it automatically
without the console"). Code: `deploy/auto-lander/` (runner, attempt log, clash resolver, red-CI reader, fix-session
launcher, reconcile, escalation), `deploy/systemd/axf-auto-lander.{service,timer}`. In this plugin:
`server/routes.py` (`/auto-lander…` routes), `server/auto_lander_health.py` (systems check item `gate-auto-lander`,
Reset and fix now), `notify.json` (`gate.auto-lander-escalated`, one push per escalated build),
`web/AutoLanderTab.tsx` (Gate → Auto-lander → Server), `web/AutoLanderSettings.tsx` (Settings → Plugins → Gate),
`test_auto_lander.py`. MCP `gate_auto_lander_*`, CLI `axf gate auto-lander …`, voice `gate.auto-lander.*`.
Doc: `_claude/memory/docs/auto-lander.md`.

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/gate/` (`rules.json`, `history.jsonl`, `lander.json`, `confirms.json`, `settings.json`).
The server auto-lander's data (`<shared data>/auto-lander/`: state, attempt logs, control, escalations) belongs to the
VPS service and stays on uninstall; `systemctl disable --now axf-auto-lander.timer` stops it.
The lander keys mirrored into the merge-queue provider's `config.json` belong to that plugin and stay on uninstall.
```bash
node apps/console-web/plugins/gate/install.mjs
node apps/console-web/plugins/gate/uninstall.mjs            # data only (backed up)
node apps/console-web/plugins/gate/uninstall.mjs --all      # + code + doc lines; --publish pushes the removal
node apps/console-web/plugins/gate/test.mjs                 # self-test
```
