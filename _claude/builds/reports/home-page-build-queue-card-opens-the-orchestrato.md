# Home page Build queue card opens the orchestrator (home-page-build-queue-card-opens-the-orchestrato)

Built Nov 10 2026 on Opus, branch `claude/home-page-build-queue-card-opens-the-orchestrato`.

Brett, Nov 9 2026: "Build queue doesn't open the orchestrator. It opens the old build queue."

## Why it opened the old queue
The Home starter card `build-summary` was the console read `builds.summary`. It drew the old framework step queue
(`framework/plan/build-queue.json`) under the title "Build queue", and its Open button called `navigate('build')`,
which is the old BuildManager screen. Nav, the app menu, the search bar, the console.queue menu and the build-breaker
menu all pointed at the same `build` view.

## Old build queue links found (s1)
| Where | What | Now |
|---|---|---|
| `src/assets/card/build-summary.json` | Home starter card, source `builds.summary` (old queue store) | reads `build-orchestrator/home-card`, opens the orchestrator |
| `src/views/BuildManager.tsx` BuildSummaryCard | "Build queue" panel, Open → `build` | retitled "Plan build steps"; Open → `build` (redirects) |
| `src/assets/nav-menu/console-nav.json` | nav item `view: build` | lands on the orchestrator through the takeover |
| `src/assets/app-menu/console.json` | `nav:build` | same |
| `src/assets/toolbar/console-search.json` | search / palette `nav:build` | same |
| `src/menu.ts` + `src/menuLibrary.tsx` | console.queue "The whole build queue…" → `nav:build` | same |
| `plugins/build-breaker/web/buildMenu.ts` | `nav:build` | same |
| `src/assets/help/console.json` | help entry `view:build` | text says it opens the orchestrator; related → `view:build-orchestrator` |
| `plugins/build-orchestrator/pipeline-core.mjs` | notification link `#/build-orchestrator`, ignored by the alerts panel | `view:build-orchestrator` |
| `server/mcp_server.py` console_open | docstring | says "build queue" opens the orchestrator |

## What changed
- **Takeover instead of a rename.** The orchestrator plugin contributes a view with the old id `build` that renders
  nothing and opens the orchestrator (`OldQueueRedirect`). `App.tsx` now lets a plugin's view win over a console view
  with the same id. Every old link keeps working and lands on the orchestrator. Without the plugin, the old screen
  comes back, so the plugin stays removable and no console asset names a missing screen.
- **One resolver** in `web/orchestrator-core.mjs`: `resolveQueueTarget()` maps `build`, `build-queue`, `Build queue`,
  `#/builds/queue`, `view:build`, `queue`, `orchestrator`, `orchestrator?tab=queued` and `orchestrator.open:<lane>`
  to the canonical target, `{ kind: 'screen', id: 'build-orchestrator', tab, link: 'view:build-orchestrator', action }`.
- **Lanes.** The action `orchestrator.open[:pending|queued|building]` opens the page on the Pipeline tab and scrolls
  to that lane. The Home card and the redirect always open the Pipeline tab, even if another tab was used last.
- **Card state** comes from `homeCard()`: counts per lane, the total, rows for the table, and the target. It is served by
  `pipeline.mjs card`, `GET /api/plugins/build-orchestrator/home-card` and the plugin command `home-card`.
- **Home cards.** Any command card whose read returns `target: { action | id }` opens there. Data cards with somewhere
  to open now have a visible Open button, like the old panel had.

## How it is reached
- Deep link: `console_open("build queue")`, `console_open("orchestrator")` or the screen id `build-orchestrator`. On one
  lane: `console_action("orchestrator.open:queued")`. Links: `view:build-orchestrator`; old `view:build` redirects.
- REST: `GET /api/control/build-orchestrator/home-card?tab=queued` (control@1) and `GET /api/plugins/build-orchestrator/home-card`.
  Open: `POST /api/console/open {"screen": "build queue"}`.
- MCP: plugin command `build-orchestrator/home-card` (read-only); `console_open` / `console_action` as above.
- CLI: `node apps/console-web/plugins/build-orchestrator/pipeline.mjs card [queued] [--json]`; `axf plugin build-orchestrator home-card`;
  `axf console open build queue`.
- Voice (AmberX): "open build queue", "open orchestrator" or "how many builds are queued". These go through the same
  control@1 console.screens resolve and the same plugin command.

## Tests
- `plugins/build-orchestrator/test.mjs` (+7 checks, 40 total): resolver, home card, starter asset source, the takeover
  and the action registered, console_open/voice resolution, CLI output equal to `homeCard()` and the plugin command, and
  the notification link.
- `plugins/build-orchestrator/test.py` (+4, 35 total): the REST route runs the CLI, gives the lane target and refuses a bad tab.
- Also green: `pipeline.test.mjs`, `check-card.mjs`, `check-theme`, `check-controls`, `check-toolbars`, `test_mcp_tools.py`, `tsc --noEmit`.

## Gaps
- No screenshots. Capturing them needs a built console under Playwright, which a headless API-key session can't run
  cheaply. UI Review is still to do.
- The agent-slots plugin's `build.queue.top` panel only showed on the old screen. While the orchestrator is on, that
  screen redirects, so the panel is no longer reachable. The Pipeline tab already shows the slots.
- Kotlin twin: none needed (console-only, no framework engine changed).
