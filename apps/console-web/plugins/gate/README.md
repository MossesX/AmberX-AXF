# VPS Configuration (console plugin)

Named **Gate & rules** until Nov 21 2026 (build `rename-gate-rules-to-vps-configuration`). The folder, plugin id, REST
prefix (`/api/plugins/gate/`), CLI (`axf gate`), MCP tools (`gate_*`, `lander_*`) and `view:gate` keep their names so
nothing saved breaks; `view:vps-configuration`, `console_open vps-configuration` and `vps.open` are the new addresses.

`ai.amberx.axf.console.gate` · built on Opus (Nov 15 2026, build `gate-rules-plugin-in-the-console`;
Brett: "Where is the gate and rules plugin, open it on my screen.").

The gate a PR must pass before it lands (gate-rules@1) and the auto-lander that lands it, in one place:
Builds → **VPS Configuration** (`view:gate`), with three tabs (framework TabGroup `gate.tabs`):

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
- Voice / console actions: `vps.open[:tab]` (`gate.open[:tab]` is the same under the old name), `gate.rule:<id>[:on|off]`, `lander.land-now:<pr>` (confirms first),
  `lander.pause[:why]`, `lander.resume`.

## Server lander (lander@1; replaced auto-lander@1 on Nov 19 2026)
The VPS runner that lands finished builds by itself (Pipeline 2.0, Brett Nov 18 2026: "absolutely no human
intervention, ever"). Code: `deploy/lander/` (`run.mjs` the tick and CLI, `lander-core.mjs` the forward-only statuses,
size-cap grouping and failure ladder, `git.mjs` one PR from every step branch + main pulled in, `store.mjs` the one seam
to the builds store), `deploy/systemd/axf-lander.{service,timer}`. The gate's build rules (phase gate, plus the command
checks of before / after rules) run inside the lander's running-ci step, once per green head (`build-rules-runner.mjs`).
In this plugin: `server/routes.py` (`/auto-lander…` routes, now answered by `deploy/lander/run.mjs`),
`server/auto_lander_health.py` (systems check item `gate-auto-lander`: service down, or builds failing repeatedly while
the lander retries), `web/AutoLanderTab.tsx` (VPS Configuration → Auto-lander → Server), `web/AutoLanderSettings.tsx` (Settings →
Plugins → Gate: the size cap and retry timing), `test_auto_lander.py`. MCP `gate_auto_lander_*`, CLI
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

## Build cap (build-cap@1)

**Build cap** tab (`tab:gate.tabs=build-cap`): the host hard cap (`maxBuilds`) and emergency slots
(`framework/cli/build-limit.mjs`) next to the orchestrator's `stepsInParallel` (its pipeline settings), with what runs
now and a note when the numbers disagree (`build-cap.mjs` → `capNote`). The hard cap and the emergency slots are
written only from Brett's own signed-in console (the route answers 403 to a session, MCP or voice, and the fields are
disabled with the reason); `stepsInParallel` is open.

| Reach | Read | Change |
| --- | --- | --- |
| REST | `GET /api/plugins/gate/build-cap` | `POST /api/plugins/gate/build-cap {stepsInParallel?, maxBuilds?, emergencySlots?}` |
| MCP | `vps_build_cap` | `vps_build_cap_set` |
| CLI | `axf gate build-cap` | `axf gate build-cap set stepsInParallel <n>` |
| Voice / actions | `vps.build-cap.status`, `vps.build-cap.open` | `vps.build-cap.set:<key>:<n>` |
| console-control@1 | `setting:vps.buildCap.maxBuilds \| emergencySlots \| stepsInParallel` | the same, `set` |

## Passes

**Passes** tab (`tab:gate.tabs=passes`, sub-tabs `tab:gate.passes.tabs=veto | hub | go`): the one home for passes.

- **Veto passes** (control-pass@1; moved from Token control → Passes, Nov 21 2026): start a pass (scope, minutes held
  to the longest-pass setting, reason, irreversible deletes), approve / deny a request, revoke, undo, what is on per
  scope, recent passes, and the longest-pass setting. The passes still belong to the control@1 runner (the Token
  control plugin's `pass/*` routes); `web/passesState.ts` calls them, owner actions with Brett's session first. The
  pass banner stays with Token control.
- **axHub passes** and **Go pass** (`web/HubPasses.tsx`, `web/HubGoPass.tsx`): the two pages of the `axhub-passes`
  plugin, which was removed. This plugin provides `view:axhub-passes`, `view:axhub-go-pass`, the actions
  `axhub-passes.open` / `axhub-go-pass.open` and the Apps → axHub menu entries, so every old link still opens them.

| Reach | Read | Change |
| --- | --- | --- |
| REST | `GET /api/plugins/token-control/pass/status`, `pass/settings` | `POST pass/grant \| approve \| deny \| revoke \| undo`, `PUT pass/settings` |
| MCP / CLI | the control@1 pass tools and `axf pass …` (unchanged) | the same |
| Voice / actions | `vps.passes.status`, `vps.passes.open[:veto\|hub\|go]` | `vps.passes.grant:<minutes>[:<scope>]`, `vps.passes.revoke[:<scope>]`, `vps.passes.max:<minutes>` |
| console-control@1 | `setting:vps.passes.maxMinutes \| timeZone \| scope \| minutes \| reason \| irreversible` | the same, `set`; buttons `vps-pass-start`, `vps-pass-settings-save`, `vps-pass-approve-<scope>` … |
