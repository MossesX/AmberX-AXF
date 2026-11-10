# Claude accounts manager

One ordered list of every Claude account on the VPS: subscription logins and API keys alike (Brett, Nov 10 2026: "API is
no longer a fallback, it's included like any other").

## What each row shows

Number in the order, name (display name), email, plan, Subscription or API, Active builder / Worker / Console account /
Not taking jobs, Out of credits (and why), usage used and left in percent, and dollars used, left and the week's total.

**Dollars:** Claude reports a subscription's usage only in percent. A subscription's week is its plan's monthly price
spread over the week (price × 7 / 30.44); used = that × the weekly percent. Prices are settings (Pro $20, Max $100,
Max 20x $200, Team, Enterprise) with an override per account. An API key shows its real spend against its weekly cap
(else its daily cap). Percent left is the tighter of the 5-hour and weekly windows.

## One order

Drag a row (or right-click → Move) to set the order. The build orchestrator takes the first account in that order that
can run the phase now, subscription or API (`pipeline-core.mjs` `routeFor`); the old API overflow rule is gone.
API keys out of the order take no build. Putting an API account in the order, or moving one earlier, bills per token:
only Brett's own click does that; a session, MCP or voice may move one later or take it out. An empty order keeps
subscriptions-only routing.

## Where

| Surface | How to reach it |
|---|---|
| Page | Builds → Claude accounts manager, `nav:claude-accounts-manager` |
| Settings | Settings → Plugins → Claude accounts manager: list, banner widget, Terminal column, floating overlay, plan prices |
| Terminal column | every Terminal window, right of the panes (slot `terminal.side`); the hamburger folds it |
| Banner widget | status asset `claude-accounts-manager`; tap = drop-down of every account; settings pick what it shows |
| Floating overlay | `claude-accounts-manager.overlay:toggle`; buttons with actions and sub-menus, resize, size lock, dock, minimize, console or whole-screen scope |
| Right-click | any row carrying `data-fx-ctx-target="claude-account"`: Claude Code as this account, rename, move, banner widget |

## API (REST, MCP, CLI, voice)

REST `/api/plugins/claude-accounts-manager/…` and MCP plugin commands (plugin-commands@1): `list` (GET accounts),
`order`, `move`, `rename`, `add`, `session`, `settings`, `settings-set`, `widget`. Console actions (MCP console
actions, voice): `claude-accounts-manager.open | session:<name> | add:<kind>:<name> | add-dialog[:<kind>] |
rename:<name> | move:<name>:<to> | overlay[:on|off|toggle] | widget:<name> | column[:on|off|toggle] | settings`.
CLI: `axf plugin claude-accounts-manager <command>` through plugin-commands. Voice: "move hulu-api to the top",
"open Claude Code as account 3", "show the accounts overlay".

## Adding an account

- **Subscription:** a Terminal tab on the VPS host runs `claude auth login` in `~/.claude-accounts/<name>`, so the live
  login and every other account are never touched. From MCP or voice (`signin: true`) the sign-in is one held axHub call
  (axf.claude-accounts@1 `signin`), in the tmux session `axf-signin-<name>`.
- **API key:** a Terminal tab runs `claude-account savekey <name>`; the key is pasted at the host's hidden prompt and
  never passes through the console.

## Claude Code as an account

A VPS host tab runs Claude Code on a private copy of that account's login (`deploy/claude-login.mjs snapshot`, Terminal
`Open.account`), the same copy a headless build gets, so the active login is never switched.

## Data and removal

`.axf-console/plugins/claude-accounts-manager/settings.json` (claude-accounts-manager@1): widget, column, overlay,
prices. Uninstalling removes the page, the Terminal column, the banner widget and the overlay. The order stays with the
build orchestrator, the logins and keys with the VPS host.

Needs `axf.claude-accounts@1`; uses `axf.claude-usage@1` (Badges) for percentages and `axf.build-dispatch@1`
(build orchestrator) for the order.

## Test

`python3 apps/console-web/plugins/claude-accounts-manager/test.py`
