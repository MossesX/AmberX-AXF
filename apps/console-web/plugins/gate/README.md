# VPS Configuration (console plugin)

Named **Gate & rules** until Nov 21 2026 (build `rename-gate-rules-to-vps-configuration`). The folder, plugin id, REST
prefix (`/api/plugins/gate/`), CLI (`axf gate`), MCP tools (`gate_*`, `lander_*`) and `view:gate` keep their names so
nothing saved breaks; `view:vps-configuration`, `console_open vps-configuration` and `vps.open` are the new addresses.

`ai.amberx.axf.console.gate` · built on Opus (Nov 15 2026, build `gate-rules-plugin-in-the-console`;
Brett: "Where is the gate and rules plugin, open it on my screen.").

The gate a PR must pass before it lands (gate-rules@1) and the auto-lander that lands it, in one place:
Builds → **VPS Configuration** (`view:gate`), in tabs (framework TabGroup `gate.tabs`; Rules, Auto-lander and History below, then one section per further tab):

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

## Approval rules (approval-rules@1)

**Approval rules** tab (`tab:gate.tabs=approvals`): axHub's match-pattern policy rules, live (axHub decisions 119 and
121, `framework/spec/AXHUB-POLICY-API.md`). Per service an ordered list of `{ match, policy, vetoSeconds }`: `match`
is a tool name or a pattern (`*` = any run of characters), `policy` is allow, veto, confirm or deny, `vetoSeconds` is
how long a veto holds (10 to 1800). The first matching rule decides a tool; a tool's own entry beats every rule until
**Let the rules decide** clears it; an allow pattern never opens a destructive tool. A rule also covers tools the
service adds later.

Every edit is staged in one draft (`approval-rules-draft.json` in the plugin's data folder) and changes nothing on
axHub. **Save** and **Apply the default** take Brett's own click and are sent from his browser on his own hub session
(`web/approvalRulesState.ts` → `saveApprovals`: a console-control press, an action or a script is refused before any
request is made; axHub refuses a bearer token anyway). The console server has no route that writes the policy.

The question before a save is asked on the tab (`button:vps-approvals-confirm`, `vps-approvals-cancel`), never with the
browser's `confirm()`: the console app's overlay WebView cannot draw that dialog and answers "no" without showing it,
which is why both buttons did nothing from Phone Connect (Nov 21 2026). The answer is the click that saves, so it must
be Brett's own. Without his axHub session the tab says Save is off here and offers **Sign in to axHub**
(`button:vps-approvals-signin`, back to this page after the sign-in); a save that fails (session ran out, hub
unreachable, hub refused) shows its reason on the tab and as a toast, and the draft is kept. Browser run:
`node apps/console-web/scripts/approval-rules-webview.mjs` (a dead `confirm()`, no session, a 401, hub down, a remote press).

**Apply the default** is Brett's rule (Nov 12 2026, again Nov 21 2026): a veto countdown only on shell commands on the
VPS (`vps.run`, `vps.launch`, `console_terminal_sessions_run`, `agent_manager_vinny_commands_by_cid_run`); every other
`axf-console` tool runs at once (`*` = allow, so screen opens, overlays and navigation are never held, new tools
included); `orchestrator_upgrade_approve` keeps confirm; deletes keep the hub's approval. The rule set is `DEFAULT` in
`web/approval-core.mjs`. While it is not applied, the systems check shows `vps-approval-default`
(`server/approval_default_health.py`) with the steps.

| Reach | Read | Stage an edit | Save |
| --- | --- | --- | --- |
| REST | `GET /api/plugins/gate/approval-rules` | `POST /api/plugins/gate/approval-rules/draft {op, service, index, to, rule, rules, clearOwn, on}` | never |
| MCP | `vps_approval_rules` | `vps_approval_rules_stage` | never |
| CLI | `axf gate approvals` | `axf gate approvals add \| edit \| remove \| move \| clear-own \| default \| discard` | never (`save` answers forbidden) |
| Voice / actions | `vps.approvals.status`, `vps.approvals.open` | `vps.approvals.add \| edit \| remove \| move \| clear-own \| discard` | never |
| console-control@1 | `setting:vps.approvals.<service>.rules \| clearOwn \| <n>.match \| <n>.policy \| <n>.vetoSeconds` (get) | the same addresses (set stages) | `button:vps-approvals-save`, `button:vps-approvals-default`: Brett's own click only |

Deep link: `console_show view:gate/tab:gate.tabs=approvals` (also `vps.open:approvals`).

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

## Model triage (model-triage@1)

**Model triage** tab (`tab:gate.tabs=model-triage`): the VPS gate that decides which model every build step, emergency
build, hand build and lander fix session runs on (Brett, Nov 21 2026: "the orchestrator stops choosing models"). The
gate is `framework/core/model-triage.mjs` (the rules, pure) and `framework/cli/model-triage.mjs` (the store, the
measured facts, the decision log); the contract is `framework/spec/MODEL-TRIAGE.md`. This plugin adds no logic: the
tab (`web/ModelTriageTab.tsx`, `web/modelTriageState.ts`) draws what `GET model-triage` answers, labels and limits
included, and sends each edit as typed; the VPS checks it and a refusal comes back as its message. The tab shows the
gate's own settings (on/off, the model when no rule matches, what a hand launch's model means, whether a brief that
names its model wins), the rules in order (on/off, model, lanes, numbers and lists, earlier / later), and the last
decisions (build and step or session, lane, model, rule, why). Each decision is also on its step in the builds store
(`triage`) and in the build's notes.

| Reach | Read | Change |
| --- | --- | --- |
| REST | `GET /api/plugins/gate/model-triage`, `model-triage/decisions`, `model-triage/history`, `POST model-triage/decide` | `POST /api/plugins/gate/model-triage {op: rule \| move \| defaults \| enabled \| reset, …}` |
| MCP | `vps_model_triage`, `vps_model_triage_decisions`, `vps_model_triage_history`, `vps_model_triage_decide` | `vps_model_triage_set` |
| CLI | `axf gate model-triage [status \| decisions \| history \| decide --text "…"]` | `axf gate model-triage rule <id> on \| off \| model <m> \| set <key> <value> \| lanes <a,b> \| move <n>`, `defaults …`, `gate on \| off`, `reset`, `pin <build> <step \| all> <opus \| fable \| none>` |
| Voice / actions | `vps.model-triage.status`, `vps.model-triage.open` | `vps.model-triage.rule:<id>:on \| off`, `vps.model-triage.default:<model>` |
| console-control@1 | `setting:vps.modelTriage.enabled \| default \| handRequest \| <rule>.enabled \| <rule>.model \| <rule>.<setting>` | the same, `set`; buttons `vps-triage-refresh`, `vps-triage-reset`, `vps-triage-<rule>-save` |

The rule store lives with the VPS (`/projects/amberx-axf/_data/model-triage`), not in this plugin's data folder:
uninstalling the plugin removes the tab, never the gate.

## Passes

**Passes** tab (`tab:gate.tabs=passes`, sub-tabs `tab:gate.passes.tabs=veto | hub | go`): the one home for passes.

- **Veto passes** (control-pass@1; moved from Token control → Passes, Nov 21 2026): start a pass (scope, minutes held
  to the longest-pass setting, reason, irreversible deletes), approve / deny a request, revoke, undo, what is on per
  scope, recent passes, and the longest-pass setting. The passes still belong to the control@1 runner (the Token
  control plugin's `pass/*` routes); `web/passesState.ts` calls them, owner actions with Brett's session first. The
  pass banner stays with Token control.
- What an axHub pass covers (pass@2 `covers`: `all` by default, or a list of services, tools and scopes), how it
  decides veto, confirm and always-approve calls, and what a covered run logs: `framework/spec/AXHUB-PASS.md`.
- **axHub passes** and **Go pass** (`web/HubPasses.tsx`, `web/HubGoPass.tsx`): the two pages of the `axhub-passes`
  plugin, which was removed. This plugin provides `view:axhub-passes`, `view:axhub-go-pass`, the actions
  `axhub-passes.open` / `axhub-go-pass.open` and the Apps → axHub menu entries, so every old link still opens them.

| Reach | Read | Change |
| --- | --- | --- |
| REST | `GET /api/plugins/token-control/pass/status`, `pass/settings` | `POST pass/grant \| approve \| deny \| revoke \| undo`, `PUT pass/settings` | <!-- axf-plugin:token-control -->
| MCP / CLI | the control@1 pass tools and `axf pass …` (unchanged) | the same |
| Voice / actions | `vps.passes.status`, `vps.passes.open[:veto\|hub\|go]` | `vps.passes.grant:<minutes>[:<scope>]`, `vps.passes.revoke[:<scope>]`, `vps.passes.max:<minutes>` |
| console-control@1 | `setting:vps.passes.maxMinutes \| timeZone \| scope \| minutes \| reason \| irreversible` | the same, `set`; buttons `vps-pass-start`, `vps-pass-settings-save`, `vps-pass-approve-<scope>` … |
