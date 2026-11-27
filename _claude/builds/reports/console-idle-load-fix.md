# console-idle-load-fix

Emergency build, Nov 23 2026. Branch `claude/console-idle-load-fix`.

## What was wrong

Measured on the live `axf-console` container before any change:

- 127–180% CPU with no HTTP requests arriving, and 3.7 GB sent out in the first minute after a restart (7.5 GB after four minutes).
- A profile of the server process (py-spy) showed the load was not the web app. Two background paths did it:
  1. **Chat viewer** sent its whole SQLite file (948 MB) to the data store after every session it stored. One sync run stores many sessions, so the file went out many times per run. This is the 72 GB out.
  2. **Phone Connect**'s long poll asks for the next call every second, and each ask re-read every command file (702 of them) twice. One ask cost 1.4 s of CPU, so the poll alone held most of a core. In shadow mode each of those reads also queued a compare against axf-data.
- Every `/api/control/<plugin>/<read>` started two Node processes (plan, finish) and made an HTTP request back to the same server.
- The wake listener's settings poll stacked one extra timer each time the lazy loader re-registered the plugin: up to 89 settings and state reads in 45 s from one tab, each able to start a Node run.
- `host-services/list` (a Home card) answered 404 on every load: the command route has no trailing slash and the server only answered with one.

## What changed

Server
- Chat viewer: writes mark the store dirty; one copy goes to the data store at the end of a sync run, at most every 30 minutes (`AXF_CHAT_VIEWER_UPLOAD_GAP_S`). The local file stays the working copy.
- Phone Connect: finished commands are read once and kept in memory, the folder listing is kept until the folder changes, the poll looks only at open commands, and the "seen" write and timeout sweep run every 10 s / 5 s instead of every poll. The sweep now covers every command, so old ones past 500 are dropped too.
- Plugin commands: `/api/control` plugin routes run in-process on the server's own event loop (loopback HTTP only as a fallback). Plan, finish and bundle go through one long-lived `node commands.mjs serve` runner, restarted when plugin files change, with the one-shot run kept as a fallback.
- Build orchestrator: status / launch-crashed cached 10 s and health live status 15 s (the commit from `claude/console-orch-cache`).
- Host services and project switcher: the list route answers without the trailing slash.

Web app
- Home cards read their plugin only while the card is on screen in a visible tab, read again on return only when the answer is older than the card's refresh, and stop asking a read that no longer exists.
- Nothing preloads the plan, pending list, tracker or build queue at start: the search index loads on first search, the pending badge when its menu is drawn, the build queue with the screens that show it.
- Wake listener: one settings poll (15 s, visible tab or listener on), refreshed at once when the tab comes back.

## Numbers

| Measure | Before | After |
| --- | --- | --- |
| Phone poll, CPU per ask (702 command files) | 1,402 ms | 0.5 ms |
| One `/api/control` plugin read | 230 ms (live console) | 46 ms (test container) |
| Node processes per `/api/control` read | 2 | 0 |
| Chat database copies to the data store | one 948 MB copy per stored session | one per sync run, at most every 30 min |
| API requests per app load, 45 s, shapes cached | 229 | 148 |
| API requests per app load, 45 s, first visit | 309 | 234 |
| `/api/control` reads on load, desktop 1440×900 | 15 | 15 (all 15 cards are on screen) |
| `/api/control` reads on load, phone 390×844 | 15 | 5 |
| Wake listener settings + state reads, 45 s | 89 | 10 |
| `/api/pending`, `/api/tracker`, `/api/build-queue`, `/api/plan` on load | 1, 2, 2, 2 | 0, 1, 1, 1 |

How these were measured
- Phone poll and control read: the same benchmark run inside the console image on main's code and on this branch, on a copy of the live state.
- Request counts: a headless browser loading the deployed web build and this branch's build against the live API through a local proxy. The test browser cannot sign in to axHub, so after the first second the app shows its "Waiting for axHub" gate while plugins keep loading behind it. Both builds were measured the same way; counts on a signed-in console will differ.
- A test container with no phone and no data store idles at 2% CPU on main's code, which is what confirms the idle load was the two background paths above and not the server at rest.

Not measured yet: `docker stats` for the live console after this lands. The under-5% idle target has to be read there once it is deployed, with the phone connected.

## Left alone

- The store's six start-up reads (catalog, tracker, libraries, boilerplates, modules) stay: Home and the tracker status use them, and the server answers them from its shared cache.
- Other background threads (activity watcher, alerts, maintenance monitor, MCP tool sync) together used about 3% of a core in the profile.
- Token control's own `control.mjs run` still starts a Node process per core control@1 command; it is not on the load path.
- No visible UI changed, so nothing was sent to UI Review.

## Tests

plugin-commands (server 51, runner 46 with new runner checks), phone-connect 334, chat-viewer 98, build-orchestrator 89, wake-listener 70, host-services, fetch-share 8, `tsc` + `vite build`.
