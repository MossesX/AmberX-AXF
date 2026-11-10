# Account order switch: Custom or Automatic (`account-order-switch-custom-drag-and-drop-order`)

Brett, Nov 10 2026 15:31 (verbatim): "Drag and drop over. In a switch, a switch if you want to customize it or do that automatically."

Model: Opus (phase 1, all 3 steps). Branch `claude/account-order-switch-custom-drag-and-drop-order`, stacked on
`claude/claude-accounts-manager-plugin-one-ordered-list` (the Claude accounts manager plugin is not on main yet; this
build amends it and the orchestrator side of the retire-build-manager work).

## What it does

One switch, **Custom order**, above the account list (Claude accounts manager page, Settings → Plugins → Claude accounts
manager → Accounts in order, the Terminal's accounts column):

- **Custom** (on, default): the orchestrator follows the drag-and-drop order exactly, subscriptions and API keys alike.
  This is the sibling build's behaviour, unchanged; the default keeps it, so nothing new bills per token.
- **Automatic** (off): every subscription first (least busy, workers before the console's account), then any ready API
  key (key saved, switched on, under caps, room; least busy, least spent). The list shows that order, nothing drags,
  and a note says how to get back. The custom order is kept and returns when the switch goes back on.

Spend guard: switching to Automatic while an API key is outside the custom order lets that key take builds, so it is
Brett's own click (a session, MCP or voice gets 403 with the reason). Switching back to Custom is free.

## Where it lives

- Engine: `pipeline-core.mjs` setting `orderMode` (`custom` | `auto`, pipeline-settings@1); `accountView` (no ranks in
  auto, API usable when ready), `candidates` (subscriptions before API when no order applies), `routeFor` (rule `auto`
  and its reason), `noAccountWhy` (names the API keys that aren't ready). CLI: `pipeline.mjs set orderMode=auto`.
- Orchestrator server: `POST /pipeline/settings {orderMode}` with `set_mode_check`; `axf.build-dispatch@1`
  `order_mode()` / `set_order_mode(mode, brett)`. Pipeline tab shows "automatic: subscriptions first, then API".
- Manager plugin: `model.effective_order(…, mode)`, `rows(…, mode)` → `mode`, `customOrder`; `GET/POST /mode`
  (`custom | auto | toggle`, spoken words map); moves and drags edit the kept custom order; `OrderSwitch` in `web/ui.tsx`.

## API (every way in)

| Way | Read | Change |
|---|---|---|
| Deep link | `nav:claude-accounts-manager`, `settings.open:claude-accounts-manager` | — |
| REST | `GET /api/plugins/claude-accounts-manager/mode` (also `accounts` → `mode`, `customOrder`); `GET /pipeline/settings` | `POST …/mode {mode}`; `POST /pipeline/settings {orderMode}` |
| MCP | plugin commands `claude-accounts-manager mode` / `mode-set`; build-orchestrator `pipeline-settings-set` | same |
| Console action / voice | — | `claude-accounts-manager.mode:custom|auto|toggle` ("account order automatic", "use my custom account order"); right-click any account row |
| CLI | `pipeline.mjs settings` ("Account order: automatic…") | `pipeline.mjs set orderMode=auto|custom`; plugin-commands runner |

## Tests

- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 39 passed (new: order switch).
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 43 passed (new: mode guard, service).
- `python3 apps/console-web/plugins/claude-accounts-manager/test.py`: 55 passed (new: auto rows, mode routes, toggle, moves on Automatic).
- `python3 apps/console-web/plugins/claude-accounts/test.py`: 89 passed. `tsc --noEmit` clean. check-theme, check-controls,
  check-toolbars, check-chrome-assets, plugin-lifecycle check claude-accounts-manager, plugin-commands check: pass.

## Left

- UI Review shots (desktop + phone) once a preview of the stack is up: the plugin isn't deployed anywhere yet, same as
  the sibling build. Then the merge queue, after the sibling PR.
- Kotlin twin: none (console-only plugin).
- Choice made without asking: Custom is the default (keeps today's behaviour and spend).
