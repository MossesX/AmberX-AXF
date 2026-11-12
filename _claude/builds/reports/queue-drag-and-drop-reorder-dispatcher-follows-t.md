# Queue drag-and-drop reorder (dispatcher follows the order)

Build `queue-drag-and-drop-reorder-dispatcher-follows-t`, Opus, Nov 12 2026.
Brett (Nov 10 2026): "Can I drag and drop builds in the queue? Yes, make it, run it now on an API account."

## What it does
- Orchestrator → Queue tab: drag a card onto another card to drop it before or after that card. Each card shows a grip and its position, plus up / down buttons.
- Right-click a queued card: Move to top, Move to bottom, Move to position N (positions 1–10 in the menu; any position through the API).
- The order is saved on the host in `<pipeline dir>/queue-order.json` (`{ order, at, by }`). `plan()` (pipeline-core) applies it, so the dispatcher's tick and the status Queue use the same order.
- A build queued after Brett's last move goes in by priority: it goes ahead of the first placed build with a lower priority (so a P0 still jumps ahead), otherwise after the placed builds with its own priority. Builds that leave the Queue are ignored.
- Each move adds a note to the build ("Moved to position N of M in the Queue (by)") and writes a `queue-move` line to the pipeline log.

## API (the same in all four)
- REST: `POST /pipeline/move {id, to: top|bottom|up|down|N}` or `{id, before|after: <id>}`; `GET /pipeline/order`; `POST /pipeline/order {ids}`.
- MCP (plugin commands): `pipeline-move`, `pipeline-order`, `pipeline-order-set`.
- Console action / deep link: `build-orchestrator.move:<build>:<top|bottom|up|down|N|before=<id>|after=<id>>`; `build-orchestrator.open:queue` opens the tab.
- CLI: `pipeline.mjs move <id> top|bottom|up|down|<N> | --before <id> | --after <id>`; `pipeline.mjs order [<id…>]`.
- Voice (AmberX): through the MCP plugin commands ("move the icon browser build to the top of the queue").

## Checks
- `pipeline.test.mjs`: 47 checks passed, including the merge / move unit tests and an e2e move → status → plan run.
- `tsc --noEmit` (console-web) is clean. check-theme, check-controls, check-toolbars and check-chrome-assets pass.

## Left open
- UI Review shots (desktop + phone) of the Queue tab were not taken. This session ran on a per-token API account, and capturing them would mean building and serving this branch's console with a mock pipeline. They are needed before the PR is called ready.
- No Android twin (no new Kotlin work).
