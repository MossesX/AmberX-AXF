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
can run the phase now, subscription or API (`pipeline-core.mjs` `routeOptions` / `routeFor`). API keys out of a set
order take no build. Putting an API account in the order, or moving one earlier, bills per token: only Brett's own
click does that; a session, MCP or voice may move one later or take it out. An empty order falls back to the
orchestrator's default: subscriptions first, then any ready API account while the API overflow rule (`apiOverflow`,
on by default) is on. Account health from the orchestrator's 5-minute sweep still takes a listed account out.

## Custom or Automatic

Brett, Nov 10 2026: "In a switch, a switch if you want to customize it or do that automatically." The **Custom order**
switch sits above the list (page, Settings, Terminal column), and its setting is the orchestrator's `orderMode`:

- **Custom** (on, the default): the orchestrator follows the drag-and-drop order exactly, subscriptions and API alike.
- **Automatic** (off): every subscription first (least busy, workers before the console's account), then any ready
  API key (least busy, least spent). The list shows that order and nothing drags. The custom order is kept and comes
  back when the switch goes on again; drags, moves and `order` calls on Automatic edit the kept order.

Automatic lets every ready API key take builds, so switching to it while an API key is outside the custom order is
Brett's own click (a session, MCP or voice gets 403); switching back to Custom is free.

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
`mode` (GET), `mode-set` (`{mode: custom|auto|toggle}`), `order-get` (GET order), `order`, `order-reset`, `move`
(`{name, to}`; `position` is the same as `to`), `rename`, `add`, `session`, `settings`, `settings-set`, `widget`.
Console actions (MCP console actions, voice): `claude-accounts-manager.open | session:<name> | add:<kind>:<name> |
add-dialog[:<kind>] | rename:<name> | move:<name>:<to> | order[:<a,b,c>] | reset | mode[:custom|auto|toggle] |
overlay[:on|off|toggle] | widget:<name> | column[:on|off|toggle] | settings`.
CLI: `axf claude-accounts-manager <command>` through plugin-commands, or the orchestrator's own
`pipeline.mjs settings` / `pipeline.mjs set order=a,b,c orderMode=custom|auto`.

The account order, each way:

| | Deep link | Read | Set the order | Move one | Reset | Custom / Automatic |
|---|---|---|---|---|---|---|
| REST | — | `GET /order`, `GET /mode`, `GET /accounts` | `POST /order {order}` | `POST /move {name, to}` | `POST /order/reset` | `POST /mode {mode}` |
| MCP | `console_show` / `console_open` `nav:claude-accounts-manager` (Settings: `settings.open:claude-accounts-manager`) | plugin command `order-get` / `mode`, console action `claude-accounts-manager.order` | `order`, action `order:<a,b,c>` | `move`, action `move:<name>:<to>` | `order-reset`, action `reset` | `mode-set`, action `mode:<m>` |
| CLI | — | `axf claude-accounts-manager order-get` | `… order --order a,b,c` | `… move --name n --position top` | `… order-reset` | `… mode-set --mode auto` |
| Voice | "open the Claude accounts manager" | "what is my account order" | "set account order w-max, w-pro" | "move hulu-api to the top" | "reset my account order" | "account order automatic" |

Every way lands on the same server functions (`order_state`, `set_order`, `model.moved`, `reset_order`, `set_mode`),
so the answers match. The spend guard is the same everywhere: putting an API key in the order or earlier, or
switching to Automatic while an API key is outside the custom order, is Brett's own click (403 otherwise).

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
