# Build report: claude-accounts-manager-plugin-one-ordered-list

**Asked (Brett, Nov 10 2026, verbatim):** "Make a plugin that reads all the accounts stored on the VPS, lists them, says if they're active builders, workers, out of credits, API or not, number in the order, usage left, percentage, plan, usage in dollars. Drag and drop to arrange the order. API is no longer a fallback, it's included like any other. Rename, add accounts and APIs in the console; it pops up the terminal and attempts the login. Terminal gets a collapsible column of all Claude accounts, managed the same; the plugin adds that column. Configurable banner widget drop-down. Floating overlay window with custom buttons, editable behavior and sub-menus, resizable, lockable, dockable, minimizable, overlay the whole OS or just the console. Right-click any account to open a Claude Code session."

**Model:** Opus (Phase 1, s1–s3). **Branch:** `claude/claude-accounts-manager-plugin-one-ordered-list`.

## What was built

- **New plugin `claude-accounts-manager`** (removable; data only in `.axf-console/plugins/claude-accounts-manager`):
  page, settings tab (list, banner widget, Terminal column, floating overlay, plan prices, install/uninstall),
  server joining `axf.claude-accounts@1` + `axf.claude-usage@1` + `axf.build-dispatch@1`, pure model `server/model.py`.
  Each row: number in the order, display name, email, plan (+ $/month), Subscription / API, Active builder / Worker /
  Console / Not taking jobs, Out of credits + why, % used / left (tighter of 5-hour and weekly), $ used / left / week.
- **One order, no API fallback:** `pipeline-core.mjs` drops `apiOverflow`; new setting `order` (pipeline-settings@1).
  With an order, the dispatcher takes the first account in it that can run the phase, subscription or API alike; API
  keys out of the order take nothing; empty order = the old subscriptions-only routing. `routeFor` rule = `order`.
  Pipeline page shows the order instead of the overflow switch.
- **Money guard:** adding an API account to the order or moving one earlier is Brett's own click (403 otherwise);
  moving one later or out is free. Enforced in the orchestrator (`set_order_check`, `order_raises_api`).
- **Capabilities added:** `axf.build-dispatch@1` `accounts() / order() / set_order(names, brett)`;
  `axf.claude-accounts@1` `label()` and `signin()`; new `axf.claude-usage@1` (Badges, the usage meter's cached read);
  new `axf.claude-accounts-manager@1` (read-only rows).
- **Terminal:** slot `terminal.side` (the plugin's collapsible column, hamburger to fold; gone with the plugin), action
  `terminal.tab:<Open>`, `Open.account` (Claude Code on the VPS host on a private copy of that account's login via
  `deploy/claude-login.mjs snapshot`), `Open.setup` (`login:<name>` = `claude auth login` in its own folder,
  `savekey:<name>` = the host's hidden key prompt). Fixed commands plus checked names only.
- **Banner widget:** status asset `claude-accounts-manager`; tap = drop-down of every account; settings pick the account
  and any combination of number, name, usage left, API/subscription, email, plan, status, dollars.
- **Floating overlay** (slot `app.frame.cover`): narrow window with custom buttons (label, icon, console action, static
  sub-menu items, live account lists: Claude Code / rename / widget), move by the title bar, resize from the corner,
  size lock, dock left/right/top/bottom, minimize to a pill, opacity, scope console or whole screen (Document
  Picture-in-Picture; falls back with a note where the browser lacks it). Framework controls and `--fx-*` tokens only.
- **Right-click** on any row with `data-fx-ctx-target="claude-account"` (page, column, overlay, drop-down): Claude Code
  as this account, rename, move top/up/down, out of / into the order, show on the banner widget.

## How each feature is reached (UI · REST · MCP · CLI · voice)

| Feature | Deep link / action | REST (`/api/plugins/claude-accounts-manager/`) | MCP | CLI | Voice |
|---|---|---|---|---|---|
| List | `nav:claude-accounts-manager` | `GET accounts` | plugin command `list` | `axf plugin claude-accounts-manager list` | "list my Claude accounts" |
| Order | `claude-accounts-manager.move:<n>:<to>` | `POST order`, `POST move` | `order`, `move` | `… order` / `… move` | "move hulu-api to the top" |
| Rename | `claude-accounts-manager.rename:<n>` | `POST rename` | `rename` | `… rename` | "call account 3 Hulu" |
| Add | `claude-accounts-manager.add:<kind>:<n>` | `POST add` (`signin: true` = held sign-in) | `add` | `… add` | "add a Claude account account-6" |
| Claude Code as | `claude-accounts-manager.session:<n>` | `POST session` | `session` + console action | `… session` | "open Claude Code as account 3" |
| Widget | `claude-accounts-manager.widget:<n>` | `GET widget`, `POST settings {widget}` | `widget`, `settings-set` | `… widget` | "show hulu-api on the banner" |
| Column | `claude-accounts-manager.column[:on|off]` | `POST settings {column}` | `settings-set` | `… settings-set` | "hide the accounts column" |
| Overlay | `claude-accounts-manager.overlay[:on|off|toggle]` | `POST settings {overlay}` | `settings-set` | `… settings-set` | "show the accounts overlay" |
| Dispatcher order | Builds → Pipeline | orchestrator `POST pipeline/settings {order}` | `pipeline-settings-set` | `pipeline.mjs set order=a,b` | — |

## Tests

- `python3 apps/console-web/plugins/claude-accounts-manager/test.py` — 44 passed
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs` — 38 passed (order routing replaces overflow)
- `python3 apps/console-web/plugins/build-orchestrator/test.py` — 35 passed (order guard)
- `python3 apps/console-web/plugins/console-terminal/test.py` — 151 passed (`account_login`, `setup_script`)
- `python3 apps/console-web/plugins/claude-accounts/test.py` — 89; `claude-badge/test.py` — 73
- console `tsc --noEmit` clean; `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`,
  `plugin-lifecycle check claude-accounts-manager`, `tracker --check`, server `test_plugin_catalog` (39), `test_mcp_tools` (203) pass

## Gaps / decisions

- **UI Review:** not submitted yet. The branch isn't deployed, so the live console can't render the new plugin for
  shots; desktop and phone shots go to UI Review once a preview of this branch is up.
- **Dollars for subscriptions are an estimate:** Claude reports only percent, so dollars = plan price over the week ×
  weekly %. Max 5x vs 20x can't be told from `claude auth status`: Max defaults to $100, set $200 per account in
  Settings → Plan prices where needed.
- **Default when no order is saved:** subscriptions in host order, API keys out (no surprise spend after deploy).
  Brett's first drag saves the order.
- **Headless job routing** (`deploy/worker-routing.mjs`, claude-workers@1 rules) is a separate path and still has its
  own API rules; this build changes the orchestrator's build dispatch only.
- **Whole-OS overlay** uses Document Picture-in-Picture (Chromium desktop). Elsewhere it stays over the console.
- **Kotlin twin:** none (console-only plugin); no framework/core engine changed.
