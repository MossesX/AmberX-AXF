# Activity Monitor plugin: live plain-English log (activity-monitor-plugin-live-plain-english-log-o)

Phase 1, Opus, headless. Branch `claude/activity-monitor-plugin-live-plain-english-log-o`.

## Brett said (verbatim, 2026-11-09 23:49)
> I need an activity log for the console. Every time something clicks, or any time something is being done, or any time an agent or employee asks for something or an approval... if you receive an error, it should note the error, and then what you do to fix it, in a very beautiful colored output window... beautiful interactive log with collapsible panes, maybe tabs... allow me to select an action and make rules, so if this happens again, you do that... see everything the console is doing, axHub's doing, any of the apps are doing through axHub... like Molly reached out to Patches through axHub to download a file. Joey sent this to the orchestrator who rejected it, and the orchestrator sent it to Patches who fixed it and sent it back... very detailed log of everything in English words.

## What was built
New plugin `apps/console-web/plugins/activity-monitor/` (not app core; removable with `uninstall.mjs --all`).

| Asked | Where it is |
|---|---|
| Every click | `web/store.ts` capture: every tap on a button, menu item, tab, switch or row → "You tapped “Queue” on builds." |
| Anything being done | every console action (menus, shortcuts, toolbars, remote callers) → "You opened the builds page. Done."; the console terminal (MCP / control commands; housekeeping as debug) |
| Agent / employee asks, approvals | `axf.hub-runs@1` → "Brett approved Molly's vps.run through axHub" + "Molly ran `…` to the VPS through axHub. Done."; `POST emit` for any app or agent |
| Orchestrator decisions | every builds-store note → queued / split / launched / rejected / handed off, one chain per build |
| Errors and the fix after them | page errors, terminal errors, feed failures; a fix event joins the error it fixed (same thing touched) and links its Automatic fixes note (`axf.changes@1`, Fix note button) |
| Beautiful coloured window | monospace output window, left border + icon + kind in the kind's colour (theme token per kind, settable), errors red, warnings amber |
| Collapsible panes, tabs | Log and Event panes (framework Containers, foldable), Rules pane; TabGroup All / Errors / Approvals / Agents / Builds / axHub / one per app with counts |
| Select an action, make rules | select any line → Retry, Open, Fix note, Whole request, **Make a rule** (prefilled from the event: when kind / app / level / who / text …, do notify / run the fix / send to an agent through the orchestrator / run a console action / note; Test against recent events; cooldown; hits; on/off; edit; delete) |
| Everything axHub and the apps do | `axHub` tab + per-app tabs; apps write through `POST /api/plugins/activity-monitor/emit` (via axHub's console proxy) or any capability service's `activity_log(since_ms)` |
| Molly / Joey / Patches story | sentences like "Molly asked Patches through axHub to download a file. Done." and "Joey sent the login fix to the orchestrator, which rejected it: no tests." with the chain (orchestrator → Patches → fixed → sent back) as one tree |
| Detailed, in English | `server/engine.py` writes each sentence from who / verb / what / to whom / through / result / reason; raw record folded under it |
| Widget | count today + errors + last error in the activity banner summary (`activity.summary`) and the Builds toolbar (`builds.toolbar`); error count is the menu badge |

## API (all four the same)
- **REST**: `/api/plugins/activity-monitor/…` and `/api/control/activity-monitor/<command>` — `events` (tab, q, kind, severity, minSeverity, app, source, actor, range, since, until, chain, limit, view=tree), `event/{id}`, `emit`, `retry/{id}`, `stats`, `export` (jsonl/csv/md/txt), `rules`, `rule-save`, `rule-from-event`, `rule-test`, `rule-delete`, `settings`, `settings-save`, `collect`, `clear` (confirm).
- **MCP**: `activity_monitor_<command>` through plugin-commands@1 (9 reads, 18 commands).
- **CLI**: `axf activity-monitor events --q "joey rejected"`, `axf activity-monitor rule-save --on '{"kind":"error"}' --do '{"type":"notify"}'` …
- **Voice / console actions** (control@1 console domain): `activity-monitor.open`, `.tab:<tab>`, `.search:<words>`, `.event:<id>`, `.pause`, `.resume`, `.follow:<on|off>`, `.layout:<tree|flat>`, `.export:<fmt>`, `.settings`.
- **Deep link**: `nav:activity-monitor` / console_open `view:activity-monitor`; View → Activity log, View → Activity log: errors, Plugins → Activity Monitor.
- **Service**: `axf.activity-log@1` (emit, query, stats, chain, rules) for other plugins.

## Tests
- `python3 apps/console-web/plugins/activity-monitor/test.py` — 46 checks (sentences, collectors with fake axHub runs / feed / dispatch, tabs, search, chains, error → fix linking, rules notify / route / action, cooldown, hits, retry, stats, export, settings validation, clear, service, file mode 0600).
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `plugin-commands check`, `plugins.mjs --check`, `tsc --noEmit`, `server/test_plugin_catalog.py`, `server/test_mcp_tools.py`: green.
- `help-coverage --check` and `menu-reach.mts`: this plugin fully covered; both still fail on main for other plugins (approvals-banner / claude-accounts help; shipped-features, glossary-index, demo-designer, book-builder menu pages).
- Live run (Playwright, scratch console, hub off): page, chains, rule form, phone layout checked; real taps and actions were captured while shooting.

## Gaps / choices
- Console actions are observed by wrapping the runtime's action bus from the plugin (restored on hot reload). A framework `ActionBus.observe()` hook would be cleaner; left out to keep this a plugin-only change.
- axHub itself does not push its own audit log yet: axHub activity arrives through approved runs (`axf.hub-runs@1`) and anything an app emits. A hub-side forwarder is the next step (axHub code, outside this plugin).
- Rule "fix" reruns the event's retry or a systems check (`run_one`); the systems check service has no per-id fix method to call.
- Rule "route" files a build in Pending (`queue: false`) so nothing starts without Brett.
- `plugin-lifecycle check` reports the gitignored `.axf-focus.json` (the live-focus note naming this plugin); not in the repo.
- Screens wait in UI Review (group in the PR).
