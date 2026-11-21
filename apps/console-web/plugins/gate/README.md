# Gate & rules (console plugin)

`ai.amberx.axf.console.gate` · built on Opus (Nov 15 2026, build `gate-rules-plugin-in-the-console`;
Brett: "Where is the gate and rules plugin, open it on my screen.").

The gates a build must pass before it lands (gate-rules@1), the build rules, the merge line and the lander, in one place:
Builds → **Gate & rules** (`view:gate`), eight tabs in one framework TabGroup (`gate.tabs`), rebuilt Nov 21 2026
(build `gates-rules-ui-rebuild`, Fable; Brett: "Rebuild the UI for that plugin... I need to be able to actually do
everything from the UI."):

- **Overview** (`overview`): the pipeline at a glance; each tile opens its tab. Run now, Pause / Resume, Check a PR.
- **Gates** (`rules`): every gate rule, grouped (Checks, UI standards, Approvals, Landing policy). The row's switch turns
  it on or off; its detail has severity, who runs it, every setting with help and its default, Save, Reset this rule.
  Reset to defaults (confirm), Check a PR, Add a policy.
- **Build rules** (`build-rules`): every build rule grouped by when it applies, filters (who, when, kind, state, search),
  Add / Edit / Delete, a rule's runs and changes, Run a build's rules (dry run first), Preview a session's brief.
- **Merge line** (`line`): the one mode switch **Merge queue** (on = PRs go through the stacked merge queue; off, the
  default = each finished build lands one at a time), status, waiting PRs with the rule that holds each and why, Land
  next, Check this PR, last runs, Pause and Resume.
- **Lander** (`auto-lander`): the VPS lander's service, the build landing, every build waiting; a build's PRs, steps,
  failure and status log; Run now, Pause / Resume, Retry, Fix now.
- **Limits** (`limits`): the lander's limits: size cap, retries, timeouts, merge method, CI workflow, Land by itself.
- **Model triage** (`triage`): kept for the VPS model triage gate (not built yet).
- **History** (`history`): gate and merge line changes, build rule changes, build rule runs, each with its filters.

**Display only (Brett, Nov 21 2026: no logic in the console).** The web folder shows what the server answers and sends
taps to it. What it must not do, and where that lives instead: flip a rule (`rules_toggle` with no `enabled`), type a
setting sent as text (`settingValue` in gate.mjs), say whether the lander is up or what may be pressed
(`service.state`, `can` in deploy/lander/run.mjs `status`), sum a verdict up (`verdictSummary`), count rules
(`counts`), default or clean a new build rule (build-rules-api.mjs), filter a list (query parameters).

Lists are short rows you tap into (`web/ui.tsx` RowList: `grid:<id>`, `row:<id>`); sections fold (the framework
Container); filters are dropdowns. Layout only in `web/gate.css`, every value a theme token.

Contract: `framework/spec/GATE.md`. Engine: `framework/core/gate-rules.mjs` (pure). This folder adds the IO:

| File | What |
| --- | --- |
| `gate-store.mjs` | the store adapter: rule set, lander config, queue and run files behind one interface (a later axf-molly backend replaces only this file and `lander.mjs`) |
| `lander.mjs` | the lander adapter: mode switch, status, waiting, runs, land now, pause, resume |
| `history.mjs` | append-only JSONL history with filters |
| `gate.mjs` | the CLI (`axf gate …`) and the JSON entry the server routes call |
| `server/routes.py` | REST `/api/plugins/gate/…` (MCP `gate_*` / `lander_*` through plugin-commands) |
| `web/` | GateView and its tabs (one file a tab), `ui.tsx` (rows, folds, tiles, toolbars), the dialogs |

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

## Server lander (lander@1; replaced auto-lander@1 on Nov 19 2026)
The VPS runner that lands finished builds by itself (Pipeline 2.0, Brett Nov 18 2026: "absolutely no human
intervention, ever"). Code: `deploy/lander/` (`run.mjs` the tick and CLI, `lander-core.mjs` the forward-only statuses,
size-cap grouping and failure ladder, `git.mjs` one PR from every step branch + main pulled in, `store.mjs` the one seam
to the builds store), `deploy/systemd/axf-lander.{service,timer}`. The gate's build rules (phase gate, plus the command
checks of before / after rules) run inside the lander's running-ci step, once per green head (`build-rules-runner.mjs`).
In this plugin: `server/routes.py` (`/auto-lander…` routes, now answered by `deploy/lander/run.mjs`),
`server/auto_lander_health.py` (systems check item `gate-auto-lander`: service down, or builds failing repeatedly while
the lander retries), `web/LanderTab.tsx` (Gate → Lander), `web/LimitsTab.tsx` (Gate → Limits and Settings → Plugins →
Gate: the size cap, retries, timeouts, merge method), `test_auto_lander.py`. MCP `gate_auto_lander_*`, CLI
`axf gate auto-lander …`, voice `gate.auto-lander.*`.

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/gate/` (`rules.json`, `history.jsonl`, `lander.json`, `confirms.json`, `settings.json`).
The lander's host files (`.axf-console/lander/`: heartbeat, pause switch, GitHub cache, local settings) belong to the
VPS service and stay on uninstall; every build status lives in the builds store. `systemctl disable --now
axf-lander.timer` stops it.
The lander keys mirrored into the merge-queue provider's `config.json` belong to that plugin and stay on uninstall.
```bash
node apps/console-web/plugins/gate/install.mjs
node apps/console-web/plugins/gate/uninstall.mjs            # data only (backed up)
node apps/console-web/plugins/gate/uninstall.mjs --all      # + code + doc lines; --publish pushes the removal
node apps/console-web/plugins/gate/test.mjs                 # self-test
```
