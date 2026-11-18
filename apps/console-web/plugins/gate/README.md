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
  `lander.pause[:why]`, `lander.resume`, `gate.land-now:<pr>` (Land now from the held-prs item, confirms first),
  `gate.setting:<key>:<value>`.

## Never wait on a missing UI Review (Nov 18 2026, build `auto-lander-never-wait-missing-ui-review`)
Brett: "If it recorded the test of the pipeline and didn't merge it on its own, then the test failed. It should have
tested itself before it did the demo." PR #816 sat held on a UI Review whose item was never posted to the console.
- **Verdict** (`framework/spec/GATE.md`, "The UI Review verdict"): the `ui-review` rule holds only when the item exists
  in the console (waiting, changes, rejected). Missing, unposted or unreadable = pass with the flag `ui-review-missing`
  (`gate-verdict@1.flagged / flags / reviewFlag / notes`). `holdOn` lists waiting, changes, rejected only.
- **Lander** (`lander.mjs`, push-banner `land.mjs` / `merge-queue.mjs`): the item is looked up in the live console
  (`GET /api/plugins/ui-review/state`) before a hold; not found lands when CI is green with `reviewFlag` on the record;
  a failed lookup is never a hold. A landing with a flagged review files a UI Review notice (Screenshots group
  `<build id> - missing review`) and a build note. `lander-state@1` records carry `heldSince`, `holdReason`, `reviewFlag`;
  `flagged[]` lists what landed flagged.
- **Setting** `heldAlertMin` (Held PR alert after, default 60 min): `setting:gate.heldAlertMin`, `PUT settings`,
  `gate_settings_set`, `axf gate settings set heldAlertMin 90`, voice `gate.setting:heldAlertMin:90`.
- **Systems check `held-prs`** (`server/held_prs_health.py`, `test_held_prs.py`): every truly held PR with build,
  reason and age; red past the limit, pushed once; **Land now** per PR (front of the merge queue with an override note,
  confirm, never a direct merge). `GET /api/plugins/gate/held-prs` (`held-prs@1`; `?limitMin=`), `POST
  /api/plugins/gate/land-now {pr, note?, confirm?}`, MCP `gate_held_prs` / `gate_land_now`, `axf gate held-prs`,
  `axf gate land-now <pr> [--note …]`, voice `gate.land-now:<pr>`; console-control `row:held-prs`,
  `grid:held-prs/row:<n>[/button:land-now]` (`web/heldPrs.ts`).
- **Build rule `ui-review-posted`** (`fixers/ui-review-posted.mjs`, doer vps, phase gate, `when.ui`): every UI Review
  item a build recorded in its worktree is in the console, else the fixer posts it; what cannot be posted holds the
  landing with the reason. Added to the live store with `axf gate build-rules add ui-review-posted --doer vps --kind
  mechanical --phase gate --check fixer:ui-review-posted --autofix ui-review-posted …` (then `edit ui-review-posted
  when {"ui":true}`); not in the committed seed (the seed is the migration's output).
- Tests: `test.mjs` (held_prs, land_now), `test_held_prs.py`, `test/test.ui-review-posted.mjs`,
  `test/test.pr-816-replay.mjs` (the #816 replay: CI green + no item → lands; held past the limit → red with Land now;
  an unconfirmed submit fails the step). Report: `_claude/builds/reports/auto-lander-never-wait-missing-ui-review.md`.

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

Settings (Settings → Plugins → Gate; `GET`/`PUT /api/plugins/gate/settings`, MCP `gate_settings` / `gate_settings_set`, `axf gate settings set <key> <value>`, voice `gate.setting:<key>:<value>`, console-control `setting:gate.<key>`): `refreshSec`, `historySize`, `defaultTab`, and `heldAlertMin` (Nov 18 2026, default 60): minutes a lander-held PR may wait before the systems check's `held-prs` item turns red.
The server auto-lander's data (`<shared data>/auto-lander/`: state, attempt logs, control, escalations) belongs to the
VPS service and stays on uninstall; `systemctl disable --now axf-auto-lander.timer` stops it.
The lander keys mirrored into the merge-queue provider's `config.json` belong to that plugin and stay on uninstall.
```bash
node apps/console-web/plugins/gate/install.mjs
node apps/console-web/plugins/gate/uninstall.mjs            # data only (backed up)
node apps/console-web/plugins/gate/uninstall.mjs --all      # + code + doc lines; --publish pushes the removal
node apps/console-web/plugins/gate/test.mjs                 # self-test
```
