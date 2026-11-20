# Console audit, step s7: extensive tests, before and after the fixes

Build `fable-full-audit-ui-overhaul-conso`, step s7. Companion to the s1 findings report
(`fable-full-audit-ui-overhaul-conso.md`) and the s5/s6 reports. This step adds a test suite that drives the real
console end to end, runs it before and after the fixes of steps s2 to s6, and fixes what the suite found that no other
step covers. Each fix is its own commit on `claude/fable-full-audit-ui-overhaul-conso--s7`.

## Summary

- The suite runs about 1,300 checks per tree: every screen, tab, Settings tab and dialog, the console commands over the
  real relay, startup and refresh, slow-console screenshots, and a server load test. before: 1189/1304,
  after s1-s6: 1146/1288, after + s7: 1142/1288. Most remaining failures are the suite's speed and quantity targets
  (calls at once, open time), not crashes: after + s7 has no page error and no blank page left (before: 2 and 2), but
  66 opens over the 8 s target (before: 7), which is R1/R2.
- Fixed here (seven small commits): a forced full systems check on every page load; three plugins that blanked the
  whole console (Build orchestrator settings, Theme manager, the UI Review options dialog); the REST open-settings
  command that opened nothing; console-control answers that showed the old tab; and Wake listener polling, which with
  three consoles open made the server start ~120 node processes a minute. Three open consoles now cost 380
  processes/min, down from 655 before and 690 after s1-s6.
- Found in the s2-s6 fixes before they land: s3 can stop plugin views rendering in a long session and makes screens
  3× slower to open (R1, R2, R3). s2 stops the "delivered with no image" screenshot, but slow captures now fail or
  go pending instead (R4).
- Brett's item 1 was reproduced on main only with a slowed console (10× CPU: "delivered" with no image). Item 4
  (CPU) traces to page-load and polling work started per open console (S7-1, S7-7, the control@1 reads), not to an
  idle loop: idle is 2-3 % in every tree.

## The suite (`apps/console-web/scripts/suite/`)

The live console's own image (`axf-console:latest`) runs the real `main:app` of a checkout copy on an internal Docker
network: no route out, so no axHub, no phone pushes, no GitHub, and none of the live console's data. A real Chromium
(Playwright) drives it over HTTP/2 + TLS, as Traefik serves the live console. Plain HTTP/1.1 would cap the page at six
connections per host, and four of those are held open by streams, so that would starve the page in a way live does not.

| File | What it does |
|---|---|
| `sandbox.mjs` | `up` / `down` / `copy` the sandboxed server (`copy` = `git archive` of a ref + the built `dist/` and generated control inventory) |
| `sbx_app.py` | the real `main:app` plus two read-only probes: `/__suite/threads` (every Python thread, its CPU, the line it sits on) and `/__suite/spawns` (every process the server starts, by command and starting thread) |
| `h2proxy.mjs` | the HTTP/2 TLS front (streams pass through as they come) |
| `console-suite.e2e.mjs` | the browser suite: sections below; every check recorded, never stops at the first failure; results saved after each section |
| `server-load.mjs` | the server load test; `--live axf-console` samples the live container read-only |
| `summary.mjs` | the before/after tables in this report |

Browser suite sections:

- **startup**: a cold load and three reloads. Measures first paint, the console ready (its control executor answers),
  settled (no call in flight for 1 s), `/api` calls in the first 10 s, how many are in flight at once, streams held
  open, calls still unanswered after 10 s, page errors, and whether the page draws.
- **screens**: every screen in the control inventory. Open it, check there is no page error and the page still draws,
  take a desktop and a phone screenshot.
- **tabs**: every tab of every screen-bound tab row. Open it and check the row reports it.
- **settings**: every Settings tab and every Settings → Plugins sub-tab.
- **dialogs**: every dialog the console announces (`GET /api/console/list?kind=dialogs`). Open it through the relay,
  check it is on screen with no page error, screenshot, close.
- **commands**: the console commands over the real relay (REST → server → stream → console → ack): clients, where,
  list ×4, open by words / id / address, the settings tab both ways, dialog close, home, back, action, screenshot
  (whole page, address, selector, bad selector), ten screenshots in a row, and soft and hard refresh. After each
  refresh the page must reload and come back, and open and screenshot must answer again.
- **slowshot**: `console_screenshot` with the page's CPU 4× and 10× slower (DevTools throttling), so a capture takes
  seconds as on the big live console or a phone. An image must come back, and the next command must still answer.
  The sandbox's normal captures (0.4-1 s) never reach the 3.5 s window behind Brett's item 1; this section does.

Server load phases (CPU in % of one core, from the container's cgroup: the server and everything it starts):
startup (45 s), idle (60 s), three open consoles (60 s), a burst of every parameterless GET route (345 routes ×3,
16 at a time), and idle after.

Run it (each run builds nothing itself: build `dist/` first):

```
node framework/cli/agent-slots.mjs heavy -- npm run build                       # in apps/console-web
node scripts/suite/sandbox.mjs copy --ref HEAD --to /tmp/axf-suite/root-x
node framework/cli/agent-slots.mjs heavy -- node scripts/suite/console-suite.e2e.mjs --root /tmp/axf-suite/root-x --label x --phone
node framework/cli/agent-slots.mjs heavy -- node scripts/suite/server-load.mjs --root /tmp/axf-suite/root-x --label x
node scripts/suite/summary.mjs --labels before,x
```

## What was run

- **before**: `main` at `66ad37ae2` (this step's base).
- **after**: `main` + s1 to s6 merged as pushed on Nov 20 (s2 `dafb3489d`, s3 `1ba879a09`, s4 `30fd789c1`,
  s5 `d1701202b`, s6 `7f3d1c274`; all merged without conflicts).
- **after + s7**: the same plus this branch. Its startup, slowshot and load runs include the wake-listener change;
  the screens to commands runs were taken just before that commit.
- **live**: the live `axf-console` container, sampled read-only for 2 minutes.

Thresholds are the suite's targets (`LIMITS` in both scripts), not measurements. A failed check means the console
missed the target, not necessarily that something crashed.

## Results

Notes on the numbers:

- CPU is capped at two cores per sandbox (`--cpus 2`). Three open consoles saturate it in every tree, so CPU does not
  tell the trees apart there; processes started per minute does.
- The VPS was busy with other builds (load average 6-8), so timings vary between runs. The s7 startup and load runs
  ran last, at load 6-7. The same tree without the wake-listener change measured the console ready in 0.4-1.2 s.
- before and after ran settings and dialogs on a fresh page (re-runs, so the dialog check is the same in both).
  after + s7 ran them at the end of one long session, which is where R1 shows (one wedge, recovered by a reload).
- The "after" full run (one long session) timed out in its dialogs. Its settings had gone to 272/340 in 1822 s
  because of R1. The re-runs on a fresh page are in the table.

### Browser suite: checks passed per section

| section | before | after (s1-s6) | after + s7 |
| --- | --- | --- | --- |
| startup | 17/36 | 19/36 | 18/36 |
| screens | 325/331 | 307/327 | 300/327 |
| tabs | 261/322 | 257/323 | 290/326 |
| settings | 341/344 | 336/340 | 296/338 |
| dialogs | 196/206 | 185/197 | 190/196 |
| commands | 43/59 | 38/59 | 45/59 |
| **total** | **1189/1304** | **1146/1288** | **1142/1288** |

### Startup and refresh (median of cold load + 3 reloads)

| measure | before | after (s1-s6) | after + s7 |
| --- | --- | --- | --- |
| first paint | 2064 ms | 1332 ms | 3268 ms |
| console ready (control executor answers) | 1989 ms | 1261 ms | 3211 ms |
| settled (no call in flight for 1 s) | never (30 s) | never (30 s) | never (30 s) |
| /api calls in the first 10 s | 86 | 68 | 68 |
| /api calls in flight at once (peak) | 58 | 42 | 34 |
| streams held open | 4 | 4 | 4 |
| calls still unanswered at 10 s (worst run) | 43 | 46 | 36 |

### console_screenshot over the relay

| measure | before | after (s1-s6) | after + s7 |
| --- | --- | --- | --- |
| ten in a row: answered with an image | 10/10 | 10/10 | 10/10 |
| ten in a row: median ms | 600 | 720 | 585 |

### Server load (sandboxed server, CPU in % of one core)

| phase | before CPU | before processes/min | after (s1-s6) CPU | after (s1-s6) processes/min | after + s7 CPU | after + s7 processes/min |
| --- | --- | --- | --- | --- | --- | --- |
| startup | 27.9 % (peak 144.1) | 108 | 27.5 % (peak 138.3) | 107.9 | 32.9 % (peak 138.6) | 113.1 |
| idle | 2.3 % (peak 4.6) | 3 | 2.4 % (peak 5.5) | 3 | 2.8 % (peak 13.1) | 3 |
| clients×3 | 157.2 % (peak 200.7) | 655 | 174 % (peak 199.9) | 689.9 | 184.7 % (peak 203.1) | 380.2 |
| burst | 151.2 % (peak 199.8) | 347.1 | 144.9 % (peak 199.9) | 330.5 | 176.8 % (peak 198.7) | 413.9 |
| idle-after | 3 % (peak 8.1) | 1.3 | 2.3 % (peak 4.5) | 1.3 | 3 % (peak 9.5) | 2.6 |
| burst p50 / p95 / max ms | 185 / 4185 / 30003 | 5 5xx · 1 timeouts | 182 / 3990 / 30011 | 5 5xx · 1 timeouts | 217 / 4901 / 30003 | 5 5xx · 2 timeouts |

### console_screenshot on a slowed console (CPU throttled through DevTools, two rounds each)

| tree | CPU 4× | CPU 10× |
| --- | --- | --- |
| before (main) | image 4.6 s · image 3.6 s | image 9.8 s · **"delivered" with no image** 6.4 s (Brett's item 1) |
| after (s1-s6) | image 9.4 s · image 16.4 s | failed "the capture took longer than 20 s" 30.1 s · pending 49.6 s |
| after + s7 | pending 18.9 s · image 10.1 s | pending 50.1 s · pending 21.1 s |

"Pending" means the server stopped waiting for the console and queued the command for AmberX to wake a console.
The sandbox has no axHub, so that path ends there. After every slow screenshot, the next `open` still answered
(0.2-6 s), so no tree writes the console off as asleep.

<details><summary>Failed checks (before): 115</summary>

- **startup** (19)
  - cold #1: settles ≤ 20 s: still busy at 30 s: /api/plugins/systems-check/check?force=1, /api/plugins/claude-accounts/routing, /api/plugins/fable-rebuilds/items, /api/plugins/gate/settings, /api/plugins/gate/auto-lander/setting
  - cold #1: ≤ 12 /api calls at once: peak 24, 30 calls in 10 s
  - cold #1: ≤ 2 streams held open: /api/alerts/stream, /api/events, /api/plugins/follow-amber/stream?client=fa-nwym9kpuwwki, /api/plugins/console-commands/stream?client=cc-lai528tox5rn
  - cold #1: nothing unanswered after 10 s: /api/plugins/systems-check/check?force=1, /api/plugins/claude-accounts/routing, /api/plugins/fable-rebuilds/items, /api/plugins/gate/settings, /api/plugins/gate/auto-lander/settings, /api/plugins/proj
  - reload #2: settles ≤ 20 s: still busy at 30 s: /api/plugins/wake-listener/report, /api/profiles, /api/plugins/claude-accounts/routing, /api/plugins/claude-accounts/accounts, /api/plugins/claude-accounts/build-account, /api/plug
  - reload #2: ≤ 12 /api calls at once: peak 51, 64 calls in 10 s
  - reload #2: ≤ 60 /api calls in the first 10 s: 64; repeated: /api/me×2, /api/plan×2, /api/plugins×2, /api/tracker×2
  - reload #2: ≤ 2 streams held open: /api/alerts/stream, /api/events, /api/plugins/follow-amber/stream?client=fa-nwym9kpuwwki, /api/plugins/console-commands/stream?client=cc-lai528tox5rn
  - reload #2: nothing unanswered after 10 s: /api/plugins/wake-listener/report, /api/profiles, /api/plugins/claude-accounts/routing, /api/plugins/claude-accounts/accounts, /api/plugins/claude-accounts/build-account, /api/plugins/follow-amber/sta
  - reload #3: settles ≤ 20 s: still busy at 30 s: /api/plugins/wake-listener/settings, /api/plugins/wake-listener/state, /api/plugins/activity/items, /api/plugins/claude-badge/vps, /api/plugins/claude-badge/amberx, /api/plugins/cl
  - reload #3: ≤ 12 /api calls at once: peak 65, 86 calls in 10 s
  - reload #3: ≤ 60 /api calls in the first 10 s: 86; repeated: /api/plugins×3, /api/plugins/wake-listener/settings×2, /api/plugins/activity/items×2, /api/plugins/claude-badge/vps×2, /api/plugins/claude-badge/amberx×2
  - reload #3: ≤ 2 streams held open: /api/alerts/stream, /api/plugins/follow-amber/stream?client=fa-nwym9kpuwwki, /api/events, /api/plugins/console-commands/stream?client=cc-lai528tox5rn
  - reload #3: nothing unanswered after 10 s: /api/plugins/wake-listener/settings, /api/plugins/wake-listener/state, /api/plugins/activity/items, /api/plugins/claude-badge/vps, /api/plugins/claude-badge/amberx, /api/plugins/claude-badge/usage, /a
  - reload #4: settles ≤ 20 s: still busy at 30 s: /api/plugins/wake-listener/settings, /api/plugins/wake-listener/state, /api/plugins/activity/items, /api/plugins/claude-session/asks, /api/plugins/claude-badge/vps, /api/plugins/cl
  - reload #4: ≤ 12 /api calls at once: peak 58, 89 calls in 10 s
  - reload #4: ≤ 60 /api calls in the first 10 s: 89; repeated: /api/plugins/wake-listener/settings×3, /api/plugins×3, /api/plugins/wake-listener/state×2, /api/plugins/activity/items×2, /api/plugins/claude-badge/vps×2
  - reload #4: ≤ 2 streams held open: /api/alerts/stream, /api/plugins/follow-amber/stream?client=fa-nwym9kpuwwki, /api/events, /api/plugins/console-commands/stream?client=cc-lai528tox5rn
  - reload #4: nothing unanswered after 10 s: /api/plugins/wake-listener/settings, /api/plugins/wake-listener/state, /api/plugins/activity/items, /api/plugins/claude-session/asks, /api/plugins/claude-badge/vps, /api/plugins/claude-badge/amberx, /
- **screens** (6)
  - Session check-in (sessions): opens: nothing on this screen is view:sessions
  - Theme manager (theme-manager): no page error: Cannot read properties of undefined (reading 'data')
  - Theme manager (theme-manager): still draws
  - Todos (todo-manager): opens: nothing on this screen is view:todo-manager
  - UI Review (ui-review): opens: no answer in 20 s
  - UI Review (ui-review): opens ≤ 8 s: 20009 ms
- **tabs** (61)
  - agent-manager › agent-manager.tabs = agents: opens: no answer in 20 s
  - agent-manager › agent-manager.tabs = agents: opens ≤ 8 s: 20009 ms
  - agent-manager › agent-manager.tabs = skills: the row reports it: row says agents
  - agent-manager › agent-manager.tabs = personas: the row reports it: row says skills
  - agent-manager › agent-manager.tabs = tools: the row reports it: row says personas
  - agent-manager › agent-manager.tabs = training: the row reports it: row says tools
  - agent-manager › agent-manager.tabs = workflows: the row reports it: row says training
  - agent-manager › agent-manager.tabs = runs: the row reports it: row says addons
  - agent-manager › agent-manager.detail-view = edit: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=edit
  - agent-manager › agent-manager.detail-view = chat: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=chat
  - agent-manager › agent-manager.detail-view = prompt: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=prompt
  - agent-swarm › agent-swarm.chat-view = all: opens: no answer in 20 s
  - agent-swarm › agent-swarm.chat-view = all: opens ≤ 8 s: 20001 ms
  - agent-swarm › agent-swarm.chat-view = brett: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.chat-view=brett
  - agent-swarm › agent-swarm.chat-view = negative: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.chat-view=negative
  - agent-swarm › agent-swarm.tabs = crew: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.tabs=crew
  - agent-swarm › agent-swarm.tabs = cards: the row reports it: row says crew
  - agent-swarm › agent-swarm.tabs = agents: the row reports it: row says cards
  - agent-swarm › agent-swarm.tabs = job-types: the row reports it: row says agents
  - agent-swarm › agent-swarm.tabs = jobs: the row reports it: row says job-types
  - agent-swarm › agent-swarm.tabs = cost: the row reports it: row says jobs
  - agent-swarm › agent-swarm.tabs = chat-settings: the row reports it: row says chat
  - agent-voice › agent-voice.section = narrator: the row reports it: row says voice
  - agent-voice › agent-voice.section = try: the row reports it: row says pronunciation
  - ai-assistant › ai-assistant.chats = chats: opens: nothing on this screen is view:ai-assistant/tab:ai-assistant.chats=chats
  - … 36 more in results.json
- **settings** (3)
  - Settings › plugins › Agent manager: opens: nothing on this screen is view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=agent-manager
  - Settings › plugins › Agent cap: opens: nothing on this screen is view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=agent-slots
  - Settings › plugins › Agent swarm: opens: nothing on this screen is view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=agent-swarm
- **dialogs** (10)
  - AI keys: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Build profiles: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Build with Mosses: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Plugin switches: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Projects: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Open a tab: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - How many options?: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - How many options?: no page error: Cannot read properties of undefined (reading 'build')
  - How many options?: closes: http 0 ·  · no answer in 30 s 
  - How many options?: page still draws
- **commands** (16)
  - open by address (settings › plugins): answered: http 500 ·  · no console answered (tried cc-6ns72ojb0d68): open the console (openUrl), then send the command again 
  - settings tab (appearance) via POST /settings: answered: http 200 ·  ·  
  - settings tab (appearance) via the command route: answered: http 200 · pending ·  [{"client":"cc-6ns72ojb0d68","ok":false,"pending":true,"message":"sent; the console didn't answer yet (it runs it when the tab wakes)"}]
  - settings tab (appearance) via the command route: answered ≤ 15 s: 21098 ms
  - open home then back: answered: http 200 · pending · not shown yet: no open console answered (tried cc-6ns72ojb0d68); it runs the moment a console opens (until 2026-11-20T08:23:42Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
  - open home then back: answered ≤ 15 s: 19996 ms
  - back: answered: http 200 · pending · not shown yet: no open console answered (tried cc-6ns72ojb0d68); it runs the moment a console opens (until 2026-11-20T08:24:01Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
  - back: answered ≤ 15 s: 18597 ms
  - refresh (soft): then open answers: answered: http 200 · pending ·  [{"client":"cc-6ns72ojb0d68","ok":false,"pending":true,"message":"sent; the console didn't answer yet (it runs it when the tab wakes)"}]
  - refresh (soft): then screenshot answers: answered: http 200 · pending · not shown yet: no open console answered (tried cc-6ns72ojb0d68); it runs the moment a console opens (until 2026-11-20T08:24:54Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
  - refresh (soft): then screenshot answers: answered ≤ 15 s: 18616 ms
  - refresh (hard): the page reloads
  - refresh (hard): the console is back ≤ 10 s: 24654 ms
  - refresh (hard): then open answers: answered: http 200 · pending ·  [{"client":"cc-6ns72ojb0d68","ok":false,"pending":true,"message":"sent; the console didn't answer yet (it runs it when the tab wakes)"}]
  - refresh (hard): then screenshot answers: answered: http 200 · pending · not shown yet: no open console answered (tried cc-6ns72ojb0d68); it runs the moment a console opens (until 2026-11-20T08:25:54Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
  - refresh (hard): then screenshot answers: answered ≤ 15 s: 18605 ms
- **server load** (4)
  - 3 open consoles cost 157.2 % CPU > 25 %
  - 3 open consoles make the server start 655 processes/min > 60 (53× AnyIO worker thread :: node apps/console-web/plugins/wake-listener/listener.mjs settings --json; 47× AnyIO worker thread :: node apps/console-web/plugins/wake-listener/listener.mjs report --json; 40× AnyIO worker thread :: node apps/console-web/plugins/token-control/control.mjs run)
  - burst 5xx: /api/console-control/state 503, /api/console-control/toolbars 503, /api/plugins/container-access/containers 502, /api/plugins/snapshot-manager/containers 502, /api/plugins/shipped-features/manifests 500
  - burst timeouts: /api/plugins/crew-live/live timeout

</details>

<details><summary>Failed checks (after (s1-s6)): 142</summary>

- **startup** (17)
  - cold #1: settles ≤ 20 s: still busy at 30 s: /api/plugins/wake-listener/report, /api/plugins/console-commands/hello, /api/plugins/build-orchestrator/table?landed=1, /api/plugins/claude-session/asks
  - cold #1: ≤ 12 /api calls at once: peak 31, 68 calls in 10 s
  - cold #1: ≤ 60 /api calls in the first 10 s: 68; repeated: /api/plugins/claude-accounts/accounts×3, /api/plugins/claude-badge/vps×3, /api/me×2, /api/plan×2, /api/build-queue×2
  - cold #1: ≤ 2 streams held open: /api/alerts/stream, /api/events, /api/plugins/follow-amber/stream?client=fa-0t3k645cwdg5, /api/plugins/console-commands/stream?client=cc-eqx1pij5wiic
  - cold #1: nothing unanswered after 10 s: /api/plugins/wake-listener/report, /api/plugins/console-commands/hello, /api/plugins/build-orchestrator/table?landed=1, /api/plugins/claude-session/asks
  - reload #2: settles ≤ 20 s: still busy at 30 s: /api/plugins/agent-slots/status, /api/plugins/wake-listener/report, /api/plugins/wake-listener/state, /api/plugins/console-terminal/hub-runs?since=1795171736191, /api/plugins/conso
  - reload #2: ≤ 12 /api calls at once: peak 42, 87 calls in 10 s
  - reload #2: ≤ 60 /api calls in the first 10 s: 87; repeated: /api/plugins/claude-badge/usage×5, /api/plugins/claude-badge/vps×4, /api/plugins/claude-badge/amberx×4, /api/plugins/activity/items×3, /api/plugins/follow-amber/state×3
  - reload #2: ≤ 2 streams held open: /api/alerts/stream, /api/events, /api/plugins/follow-amber/stream?client=fa-0t3k645cwdg5, /api/plugins/console-commands/stream?client=cc-eqx1pij5wiic
  - reload #2: nothing unanswered after 10 s: /api/plugins/agent-slots/status, /api/plugins/wake-listener/report, /api/plugins/wake-listener/state, /api/plugins/console-terminal/hub-runs?since=1795171736191, /api/plugins/console-terminal/headless
  - reload #3: settles ≤ 20 s: still busy at 30 s: /api/alerts, /api/plugins/builds-page/progress, /api/plugins/codebase-changes/entries?open=1&limit=50, /api/plugins/claude-settings/settings, /api/plugins/console-commands/seen, /a
  - reload #3: ≤ 12 /api calls at once: peak 29, 41 calls in 10 s
  - reload #3: nothing unanswered after 10 s: /api/alerts, /api/plugins/builds-page/progress, /api/plugins/codebase-changes/entries?open=1&limit=50, /api/plugins/claude-settings/settings, /api/plugins/console-commands/seen, /api/plugins/ui-review
  - reload #4: first paint ≤ 4 s: 7980 ms
  - reload #4: settles ≤ 20 s: still busy at 30 s: /api/plugins/claude-badge/amberx, /api/plugins/claude-badge/usage, /api/alerts, /api/plugins/systems-check/check?force=1, /api/plugins/systems-check/whats-new, /api/plugins/ui-revi
  - reload #4: ≤ 12 /api calls at once: peak 44, 50 calls in 10 s
  - reload #4: nothing unanswered after 10 s: /api/plugins/claude-badge/amberx, /api/plugins/claude-badge/usage, /api/alerts, /api/plugins/systems-check/check?force=1, /api/plugins/systems-check/whats-new, /api/plugins/ui-review/choices/asks, /ap
- **screens** (20)
  - Build orchestrator (build-orchestrator): opens ≤ 8 s: 13170 ms
  - Crew (crew): opens ≤ 8 s: 9191 ms
  - Demonstration Designer (demonstration-designer): opens ≤ 8 s: 8366 ms
  - Glossary & Index (glossary-index): opens ≤ 8 s: 8685 ms
  - Maintenance (maintenance): opens ≤ 8 s: 8774 ms
  - MCP client (mcp): opens ≤ 8 s: 10518 ms
  - MD Studio (md-studio): opens ≤ 8 s: 9408 ms
  - Merge queue (merge-queue): opens ≤ 8 s: 9305 ms
  - Notes (notes): opens ≤ 8 s: 9317 ms
  - Audio out (output-recorder): opens ≤ 8 s: 9915 ms
  - Plugin commands (plugin-commands): opens ≤ 8 s: 10411 ms
  - Plugin Manager (plugin-manager): opens ≤ 8 s: 11283 ms
  - Plugin Update (plugin-update): opens ≤ 8 s: 9999 ms
  - New project (project-wizard): opens ≤ 8 s: 10231 ms
  - Session check-in (sessions): opens: nothing on this screen is view:sessions
  - Skin editor (skin-editor): opens ≤ 8 s: 10230 ms
  - Theme editor (theme-editor): opens ≤ 8 s: 10551 ms
  - Theme manager (theme-manager): opens: no answer in 20 s
  - Theme manager (theme-manager): opens ≤ 8 s: 20001 ms
  - Theme manager (theme-manager): still draws
- **tabs** (66)
  - agent-manager › agent-manager.tabs = agents: opens: no answer in 20 s
  - agent-manager › agent-manager.tabs = agents: opens ≤ 8 s: 20001 ms
  - agent-manager › agent-manager.tabs = skills: the row reports it: row says agents
  - agent-manager › agent-manager.tabs = tools: the row reports it: row says personas
  - agent-manager › agent-manager.tabs = training: the row reports it: row says tools
  - agent-manager › agent-manager.tabs = memory: the row reports it: row says workflows
  - agent-manager › agent-manager.tabs = addons: the row reports it: row says memory
  - agent-manager › agent-manager.tabs = runs: the row reports it: row says addons
  - agent-manager › agent-manager.detail-view = edit: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=edit
  - agent-manager › agent-manager.detail-view = chat: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=chat
  - agent-manager › agent-manager.detail-view = prompt: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=prompt
  - agent-swarm › agent-swarm.chat-view = all: opens: no answer in 20 s
  - agent-swarm › agent-swarm.chat-view = all: opens ≤ 8 s: 20002 ms
  - agent-swarm › agent-swarm.chat-view = brett: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.chat-view=brett
  - agent-swarm › agent-swarm.chat-view = negative: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.chat-view=negative
  - agent-swarm › agent-swarm.tabs = crew: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.tabs=crew
  - agent-swarm › agent-swarm.tabs = cards: the row reports it: row says crew
  - agent-swarm › agent-swarm.tabs = agents: the row reports it: row says cards
  - agent-swarm › agent-swarm.tabs = job-types: the row reports it: row says agents
  - agent-swarm › agent-swarm.tabs = jobs: the row reports it: row says job-types
  - agent-swarm › agent-swarm.tabs = cost: the row reports it: row says jobs
  - agent-swarm › agent-swarm.tabs = chat: the row reports it: row says cost
  - agent-swarm › agent-swarm.tabs = chat-settings: the row reports it: row says chat
  - agent-voice › agent-voice.section = narrator: the row reports it: row says voice
  - agent-voice › agent-voice.section = permissions: the row reports it: row says narrator
  - … 41 more in results.json
- **settings** (4)
  - Settings › plugins › Agent manager: opens: nothing on this screen is view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=agent-manager
  - Settings › plugins › Agent cap: opens: nothing on this screen is view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=agent-slots
  - Settings › plugins › Agent swarm: opens: nothing on this screen is view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=agent-swarm
  - Settings › plugins › Build orchestrator: opens ≤ 8 s: 8736 ms
- **dialogs** (12)
  - AI keys: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Build profiles: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Build with Mosses: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Plugin switches: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Projects: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Open a tab: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - How many options?: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - How many options?: no page error: Cannot read properties of undefined (reading 'build')
  - How many options?: closes: http 0 ·  · no answer in 30 s 
  - How many options?: page still draws
  - What's new: opens: http 0 ·  · no answer in 30 s 
  - Console token: closes: http 200 · pending · not shown yet: no open console answered (tried cc-k9k7o94qannu); it runs the moment a console opens (until 2026-11-20T10:41:58Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
- **commands** (21)
  - open builds (by id): answered: http 200 · pending · not shown yet: no open console answered (tried cc-k9k7o94qannu); it runs the moment a console opens (until 2026-11-20T10:43:29Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
  - open builds (by id): answered ≤ 15 s: 18659 ms
  - open by address (settings › plugins): answered: http 500 ·  · no console answered (tried cc-k9k7o94qannu): open the console (openUrl), then send the command again 
  - settings tab (appearance) via POST /settings: answered: http 200 ·  ·  
  - settings tab (appearance) via the command route: answered: http 200 · pending ·  [{"client":"cc-k9k7o94qannu","ok":false,"pending":true,"message":"sent; the console didn't answer yet (it runs it when the tab wakes)"}]
  - settings tab (appearance) via the command route: answered ≤ 15 s: 27873 ms
  - dialog close: answered ≤ 15 s: 18621 ms
  - home: answered: http 0 ·  · no answer in 45 s 
  - home: answered ≤ 15 s: 45003 ms
  - open home then back: answered: http 200 · pending ·  [{"client":"cc-k9k7o94qannu","ok":false,"pending":true,"message":"sent; the console didn't answer yet (it runs it when the tab wakes)"}]
  - open home then back: answered ≤ 15 s: 26769 ms
  - refresh (soft): then open answers: answered: http 0 ·  · no answer in 45 s 
  - refresh (soft): then open answers: answered ≤ 15 s: 45001 ms
  - refresh (soft): then screenshot answers: answered: http 0 ·  · no answer in 45 s 
  - refresh (soft): then screenshot answers: answered ≤ 15 s: 45004 ms
  - refresh (hard): answered: http 0 ·  · no answer in 45 s 
  - refresh (hard): answered ≤ 15 s: 45015 ms
  - refresh (hard): the page reloads
  - refresh (hard): the console is back ≤ 10 s: 47890 ms
  - refresh (hard): then screenshot answers: answered: http 0 ·  · no answer in 45 s 
  - refresh (hard): then screenshot answers: answered ≤ 15 s: 45002 ms
- **slowshot** (2)
  - screenshot with the CPU 10× slower: answered with an image: http 200 · failed · the capture took longer than 20 s [{"client":"cc-1rvi353bp9mx","ok":false,"message":"the capture took longer than 20 s","here":{"screen":"plan-studio","tabs":{"view:plan-studio/tab
  - screenshot with the CPU 10× slower: answered ≤ 30 s: 30100 ms
- **server load** (4)
  - 3 open consoles cost 174 % CPU > 25 %
  - 3 open consoles make the server start 689.9 processes/min > 60 (70× AnyIO worker thread :: node apps/console-web/plugins/wake-listener/listener.mjs settings --json; 40× AnyIO worker thread :: node deploy/worker-routing.mjs normalize; 37× AnyIO worker thread :: node apps/console-web/plugins/wake-listener/listener.mjs report --json)
  - burst 5xx: /api/console-control/state 503, /api/console-control/toolbars 503, /api/plugins/container-access/containers 502, /api/plugins/shipped-features/manifests 500, /api/plugins/snapshot-manager/containers 502
  - burst timeouts: /api/plugins/crew-live/live timeout

</details>

<details><summary>Failed checks (after + s7): 146</summary>

- **startup** (18)
  - cold #1: settles ≤ 20 s: still busy at 30 s: /api/plugins/systems-check/check?keys=1, /api/plugins/claude-accounts/build-account, /api/profiles, /api/plugins/crew-live/agents, /api/plugins/wake-listener/settings, /api/plugins
  - cold #1: ≤ 12 /api calls at once: peak 34, 68 calls in 10 s
  - cold #1: ≤ 60 /api calls in the first 10 s: 68; repeated: /api/plugins/claude-badge/usage×4, /api/plugins/claude-accounts/accounts×3, /api/plugins/claude-badge/vps×3, /api/me×2, /api/plan×2
  - cold #1: ≤ 2 streams held open: /api/alerts/stream, /api/events, /api/plugins/follow-amber/stream?client=fa-nsaqlpf70ab3, /api/plugins/console-commands/stream?client=cc-twwbuqci0fla
  - cold #1: nothing unanswered after 10 s: /api/plugins/systems-check/check?keys=1, /api/plugins/claude-accounts/build-account, /api/profiles, /api/plugins/crew-live/agents, /api/plugins/wake-listener/settings, /api/plugins/wake-listener/state
  - reload #2: settles ≤ 20 s: still busy at 30 s: /api/plugins/console-commands/hello, /api/plugins/build-orchestrator/table?landed=1, /api/plugins/wake-listener/settings, /api/plugins/wake-listener/state, /api/plugins/claude-sess
  - reload #2: ≤ 12 /api calls at once: peak 36, 50 calls in 10 s
  - reload #2: ≤ 2 streams held open: /api/alerts/stream, /api/events, /api/plugins/follow-amber/stream?client=fa-nsaqlpf70ab3
  - reload #2: nothing unanswered after 10 s: /api/plugins/console-commands/hello, /api/plugins/build-orchestrator/table?landed=1, /api/plugins/wake-listener/settings, /api/plugins/wake-listener/state, /api/plugins/claude-session/asks, /api/plugi
  - reload #3: settles ≤ 20 s: still busy at 30 s: /api/alerts, /api/plugins/claude-settings/settings, /api/plugins/console-commands/seen, /api/build-queue, /api/plugins/token-control/pass/status, /api/profiles
  - reload #3: ≤ 12 /api calls at once: peak 27, 96 calls in 10 s
  - reload #3: ≤ 60 /api calls in the first 10 s: 96; repeated: /api/plugins/follow-amber/state×4, /api/plugins/claude-badge/vps×4, /api/plugins/claude-badge/amberx×4, /api/build-queue×3, /api/plugins/token-control/pass/status×3
  - reload #3: ≤ 2 streams held open: /api/alerts/stream, /api/events, /api/plugins/follow-amber/stream?client=fa-nsaqlpf70ab3, /api/plugins/console-commands/stream?client=cc-twwbuqci0fla
  - reload #3: nothing unanswered after 10 s: /api/alerts, /api/plugins/claude-settings/settings, /api/plugins/console-commands/seen, /api/build-queue, /api/plugins/token-control/pass/status, /api/profiles, /api/plugins/ui-review/choices/assets, 
  - reload #4: first paint ≤ 4 s: 4568 ms
  - reload #4: settles ≤ 20 s: still busy at 30 s: /api/plugins/wake-listener/state, /api/plugins/claude-badge/vps, /api/plugins/claude-badge/amberx, /api/plugins/claude-badge/usage, /api/plugins/claude-session/asks, /api/control/b
  - reload #4: ≤ 12 /api calls at once: peak 28, 38 calls in 10 s
  - reload #4: nothing unanswered after 10 s: /api/plugins/wake-listener/state, /api/plugins/claude-badge/vps, /api/plugins/claude-badge/amberx, /api/plugins/claude-badge/usage, /api/plugins/claude-session/asks, /api/control/build-orchestrator/pr
- **screens** (27)
  - AmberX listeners (amberx-listeners): opens ≤ 8 s: 9410 ms
  - Brand library (brand-library): opens ≤ 8 s: 14409 ms
  - Build Breaker (build-breaker): opens: no answer in 20 s
  - Build Breaker (build-breaker): opens ≤ 8 s: 20006 ms
  - Build orchestrator (build-orchestrator): opens ≤ 8 s: 19641 ms
  - Changes & features (changes-grid): opens ≤ 8 s: 9402 ms
  - Chats (chat-viewer): opens ≤ 8 s: 9106 ms
  - Context menu designer (context-menu-designer): opens ≤ 8 s: 8612 ms
  - Fable rebuilds (fable-rebuilds): opens ≤ 8 s: 9052 ms
  - Gate & rules (gate): opens ≤ 8 s: 11216 ms
  - Glossary & Index (glossary-index): opens ≤ 8 s: 10386 ms
  - Maintenance (maintenance): opens ≤ 8 s: 8603 ms
  - MCP client (mcp): opens ≤ 8 s: 9028 ms
  - MD Studio (md-studio): opens ≤ 8 s: 9281 ms
  - Merge queue (merge-queue): opens ≤ 8 s: 10064 ms
  - Notes (notes): opens ≤ 8 s: 9566 ms
  - Audio out (output-recorder): opens ≤ 8 s: 9952 ms
  - Plugin commands (plugin-commands): opens ≤ 8 s: 9245 ms
  - Plugin Manager (plugin-manager): opens ≤ 8 s: 10341 ms
  - Plugin Update (plugin-update): opens ≤ 8 s: 12568 ms
  - New project (project-wizard): opens ≤ 8 s: 11565 ms
  - Session check-in (sessions): opens: nothing on this screen is view:sessions
  - Skin editor (skin-editor): opens ≤ 8 s: 11259 ms
  - Theme editor (theme-editor): opens ≤ 8 s: 11384 ms
  - Theme manager (theme-manager): opens ≤ 8 s: 13845 ms
  - … 2 more in results.json
- **tabs** (36)
  - agent-manager › agent-manager.tabs = agents: opens ≤ 8 s: 11371 ms
  - agent-manager › agent-manager.detail-view = edit: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=edit
  - agent-manager › agent-manager.detail-view = chat: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=chat
  - agent-manager › agent-manager.detail-view = prompt: opens: nothing on this screen is view:agent-manager/tab:agent-manager.detail-view=prompt
  - agent-swarm › agent-swarm.chat-view = all: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.chat-view=all
  - agent-swarm › agent-swarm.chat-view = all: opens ≤ 8 s: 16467 ms
  - agent-swarm › agent-swarm.chat-view = brett: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.chat-view=brett
  - agent-swarm › agent-swarm.chat-view = negative: opens: nothing on this screen is view:agent-swarm/tab:agent-swarm.chat-view=negative
  - agent-swarm › agent-swarm.tabs = agents: opens ≤ 8 s: 12808 ms
  - ai-assistant › ai-assistant.chats = chats: opens: nothing on this screen is view:ai-assistant/tab:ai-assistant.chats=chats
  - ai-assistant › ai-assistant.chats = archived: opens: nothing on this screen is view:ai-assistant/tab:ai-assistant.chats=archived
  - build-breaker › build-breaker.view = all: opens ≤ 8 s: 12886 ms
  - build-orchestrator › build-orchestrator.build = steps: opens: no answer in 20 s
  - build-orchestrator › build-orchestrator.build = steps: opens ≤ 8 s: 20002 ms
  - build-orchestrator › build-orchestrator.build = attempts: opens: nothing on this screen is view:build-orchestrator/tab:build-orchestrator.build=attempts
  - gate › gate.auto-lander.tabs = server: opens: nothing on this screen is view:gate/tab:gate.auto-lander.tabs=server
  - gate › gate.auto-lander.tabs = server: opens ≤ 8 s: 14726 ms
  - gate › gate.auto-lander.tabs = line: opens: nothing on this screen is view:gate/tab:gate.auto-lander.tabs=line
  - glossary-index › glossary.book = chapters: opens: nothing on this screen is view:glossary-index/tab:glossary.book=chapters
  - glossary-index › glossary.book = chapters: opens ≤ 8 s: 14554 ms
  - glossary-index › glossary.book = plan: opens: nothing on this screen is view:glossary-index/tab:glossary.book=plan
  - glossary-index › glossary.book = docs: opens: nothing on this screen is view:glossary-index/tab:glossary.book=docs
  - glossary-index › glossary.book = outputs: opens: nothing on this screen is view:glossary-index/tab:glossary.book=outputs
  - glossary-index › glossary.designer = demonstration: opens: nothing on this screen is view:glossary-index/tab:glossary.designer=demonstration
  - glossary-index › glossary.designer = clip: opens: nothing on this screen is view:glossary-index/tab:glossary.designer=clip
  - … 11 more in results.json
- **settings** (42)
  - Settings › plugins › AI keys: opens ≤ 8 s: 13827 ms
  - Settings › plugins › AmberX listeners: opens ≤ 8 s: 14067 ms
  - Settings › plugins › Brand library: opens ≤ 8 s: 15663 ms
  - Settings › plugins › Changes & features grid: opens ≤ 8 s: 15710 ms
  - Settings › plugins › Chat viewer: opens ≤ 8 s: 14717 ms
  - Settings › plugins › Container access: opens ≤ 8 s: 17450 ms
  - Settings › plugins › Context menu designer: opens ≤ 8 s: 16095 ms
  - Settings › plugins › Data store: opens ≤ 8 s: 16064 ms
  - Settings › plugins › Demonstration Designer: opens ≤ 8 s: 15397 ms
  - Settings › plugins › Fable rebuilds: opens ≤ 8 s: 19644 ms
  - Settings › plugins › Feature assistant: opens ≤ 8 s: 18056 ms
  - Settings › plugins › Feature matrix: opens ≤ 8 s: 18741 ms
  - Settings › plugins › Gate: opens: no answer in 20 s
  - Settings › plugins › Gate: opens ≤ 8 s: 20001 ms
  - Settings › plugins › GitHub: opens ≤ 8 s: 18458 ms
  - Settings › plugins › Glossary & Index: opens ≤ 8 s: 17292 ms
  - Settings › plugins › Maintenance: opens ≤ 8 s: 19226 ms
  - Settings › plugins › MD Studio: opens ≤ 8 s: 18833 ms
  - Settings › plugins › Merge queue: opens ≤ 8 s: 17665 ms
  - Settings › plugins › Gizmo guide: opens: no answer in 20 s
  - Settings › plugins › Gizmo guide: opens ≤ 8 s: 20002 ms
  - Settings › plugins › Notes: opens ≤ 8 s: 17717 ms
  - Settings › plugins › Audio Output Recorder: opens ≤ 8 s: 17751 ms
  - Settings › plugins › Phone Connect: opens ≤ 8 s: 19441 ms
  - Settings › plugins › Plan Studio 2.0: opens ≤ 8 s: 17955 ms
  - … 17 more in results.json
- **dialogs** (6)
  - AI keys: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Build profiles: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Build with Mosses: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Plugin switches: opens: http 200 · pending · not shown yet: no open console answered (tried cc-gc6ep09c4aui); it runs the moment a console opens (until 2026-11-20T10:00:44Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
  - Projects: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
  - Open a tab: the dialog is on screen: the console says no dialog is open (it closed at once: not registered?)
- **commands** (14)
  - open by address (settings › plugins): answered: http 500 ·  · no console answered (tried cc-gc6ep09c4aui): open the console (openUrl), then send the command again 
  - settings tab (appearance) via POST /settings: answered: http 0 ·  · no answer in 45 s 
  - settings tab (appearance) via POST /settings: answered ≤ 15 s: 45001 ms
  - settings tab (appearance) via the command route: answered ≤ 15 s: 37601 ms
  - refresh (soft): then open answers: answered: http 0 ·  · no answer in 45 s 
  - refresh (soft): then open answers: answered ≤ 15 s: 45001 ms
  - refresh (soft): then screenshot answers: answered: http 0 ·  · no answer in 45 s 
  - refresh (soft): then screenshot answers: answered ≤ 15 s: 45000 ms
  - refresh (hard): answered: http 0 ·  · no answer in 45 s 
  - refresh (hard): answered ≤ 15 s: 45002 ms
  - refresh (hard): the page reloads
  - refresh (hard): the console is back ≤ 10 s: 51538 ms
  - refresh (hard): then open answers: answered: http 200 · pending ·  [{"client":"cc-gc6ep09c4aui","ok":false,"pending":true,"message":"sent; the console didn't answer yet (it runs it when the tab wakes)"}]
  - refresh (hard): then open answers: answered ≤ 15 s: 15087 ms
- **slowshot** (3)
  - screenshot with the CPU 4× slower: answered with an image: http 200 · pending · not shown yet: no open console answered (tried cc-szu2j3xp62mu); it runs the moment a console opens (until 2026-11-20T11:26:29Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
  - screenshot with the CPU 10× slower: answered with an image: http 200 · pending · not shown yet: no open console answered (tried cc-szu2j3xp62mu); it runs the moment a console opens (until 2026-11-20T11:27:24Z); axHub isn't connected (no AXHUB_TOKEN), so AmberX
  - screenshot with the CPU 10× slower: answered ≤ 30 s: 49600 ms
- **server load** (4)
  - 3 open consoles cost 184.7 % CPU > 25 %
  - 3 open consoles make the server start 380.2 processes/min > 60 (36× AnyIO worker thread :: node apps/console-web/plugins/plugin-commands/commands.mjs plan; 36× AnyIO worker thread :: node apps/console-web/plugins/plugin-commands/commands.mjs finish; 29× AnyIO worker thread :: node deploy/worker-routing.mjs normalize)
  - burst 5xx: /api/console-control/state 503, /api/console-control/toolbars 503, /api/plugins/container-access/containers 502, /api/plugins/snapshot-manager/containers 502, /api/plugins/shipped-features/manifests 500
  - burst timeouts: /api/plugins/crew-live/live timeout, /api/plugins/snapshot-manager/settings error

</details>

## Live console (read-only sample, Nov 20 07:40 UTC, 120 s)

55 % of one core on average, with a 70 s stretch at 60-87 %. During that stretch the processes running were one
`plugin-lifecycle.mjs checks <plugin>` per plugin. That is the systems check pass (`derive.py`: one node process
per plugin with hooks, six at a time). It runs every 15 minutes and at console start, and before this step also on
every page load (see S7-1).

## Found by the suite and fixed in this step

| # | Finding | Evidence | Fix (commit) |
|---|---|---|---|
| S7-1 | Every console load forced a full systems check. `check?force=1` skips the server's 60 s cache and its single-flight read, and runs every plugin's self-checks (about 60 node processes). One per page load and one per open tab. | before: `systems-check/check?force=1` took 21.8 s in every startup run. It is the CPU spike seen live. | A load asks for the plain check. The keys and tokens are still tested live on every load (Oct 23 rule), and the rest comes from the shared run. Check again and a token change still force. A stale AI routine is still refreshed at start. (*Systems check: a console load no longer forces the whole check*) |
| S7-2 | Settings → Plugins → Build orchestrator blanked the whole console. The Recovery watchdog panel called `watchdog/*`, but its server routes are `recovery-watchdog/*` since the stale-row watchdog (#780) took `watchdog/*`. `GET watchdog/settings` got the SPA's HTML, `r.settings` was undefined, and the page crashed. Run now ran the other watchdog's pass. Save wrote the other watchdog's settings. | before: page error `reading 'enabled'`, the page stopped drawing | The six calls point at `recovery-watchdog/*`. (*Build orchestrator: the Recovery watchdog panel calls its own routes*) |
| S7-3 | `POST /api/console/settings {tab}` opened nothing. Two routes sat on one path (wake-settings save, open a tab), and the first shadowed the second. MCP `console_settings` was not affected (it bypasses the route). | before: answered in 64 ms with the wake settings and no console delivery | One handler: a body with a tab opens it, any other body saves. Two test checks added (149 pass in the merged tree). (*Console commands: POST /settings with a tab opens it again*) |
| S7-4 | The Theme manager screen blanked the whole console when an optional asset type (banner, clock, badge) has nothing active. It read `rt.asset(t).data` for every type. | before and after: page error `reading 'data'` | Reads `assetOrNull` and leaves such types out. (*Theme manager: an optional asset type…*) |
| S7-5 | The "How many options?" dialog opened by id (console_dialog, search) blanked the console. It has no question when opened that way. | before: page error `reading 'build'` | Says no build is asking. (*UI Review: the options question dialog…*) |
| S7-6 | A console-control answer showed the state from before the command. Opening a tab answered with the tab row's previous value, so a session reading it would think the tab never switched. | before: 22 tab checks got the previous tab back (after s1-s6: 28); after + s7: 0 | Commands that change something wait two frames (or 60 ms each, for a hidden tab) before the snapshot. (*Console control: an answer's state shows the change it made*) |
| S7-7 | Open consoles drove the server to 1.5 cores, the biggest share from Wake listener. Each tab polled `GET settings` every 6 s and posted a report on every banner paint (at most every 2 s), and every call started its own `listener.mjs` node process. | before, three open consoles (HTTP/2): 655 processes/min, listener.mjs settings 53/min, report 47/min, state 24/min (after s1-s6: 70, 37, 32). With the fix: 380 processes/min in total, and no listener.mjs command among the top ten (each under 7/min) | Settings (5 s) and state (2 s) are one shared single-flight read for every tab, and any write drops them. A page only reports when its state changed. Test added (70 pass). (*Wake listener: open consoles share its settings and state reads*) |

No shell-level error boundary exists: a throwing plugin screen or dialog blanks the whole console until a reload
(S7-2, S7-4, S7-5 all did). Only Follow Amber has one. Recommended for the UI steps: an error boundary around every
plugin view, dialog and settings panel, so a broken plugin shows a note in its own box.

## Found by the suite in the s2-s6 fixes (for this build before it lands)

- **R1 (s3, blocker): after a long session, plugin views can stop rendering.** In the full after run (screens and
  tabs first, then settings), Settings → Plugins sub-tabs went from 13-18 s to never answering (20 s timeouts, one
  after another; the run hit its 50 minute limit in the dialogs). The after + s7 run, which also has s3, wedged once
  in settings the same way, and the suite reloaded the page to carry on. The server was idle and answering in 17 ms
  the whole time. On a fresh page the same settings pass in 150 s (after-r2: 336/340), so it builds up over a session.
  Likely cause (read from the code, not traced in the browser): s3's `runBoot` wraps each wave in `hold++` … `release()`, and `bump()` (the re-render that installs a loaded plugin) does nothing while
  `hold > 0`. A screen the user opens during a wave waits for that wave to finish. A wave whose import never settles
  (`Promise.allSettled` over requests that can stay pending) keeps `hold` above 0, and nothing renders again until a
  reload. On a first visit or after a deploy (every plugin's shape unknown), the learn waves run at idle for minutes.
  That is exactly when Brett refreshes. Suggested fix: don't hold for the learn and idle waves, let a plugin someone
  asked for (open, settings, dialog) install at once whatever the hold, and give each wave a timeout.
- **R2 (s3): opening screens got slower.** The screens section took 582 s after vs 191 s before for the same screens,
  and 18 screens took longer than 8 s to open (none before). Same cause as R1 (installs held during waves).
- **R3 (s3): the same first calls repeat 4-5× on a cold load** (`claude-accounts/accounts` ×5, `claude-badge/vps` ×4,
  `follow-amber/state` ×4; before, nothing repeated more than twice). Each wave's `release()` re-installs the libraries,
  and banners that already mounted fetch again. Reloads are fine (the plugins' shapes are known by then). The load
  test's tabs are fresh browser profiles, so every load there is a first visit. That is why three open consoles cost
  more after (174 % CPU, 690 processes/min) than before (157 %, 655/min): `claude-accounts` `worker-routing.mjs
  normalize` went from under 6 to 40 a minute.

- **R4 (s2): slow screenshots no longer come back empty, but they don't come back.** On main, a capture with the CPU
  10× slower once answered "delivered" with no image (s1 F1, Brett's item 1). With s2 that never happens. But the
  same captures take 2-4× longer (4×: 9-16 s vs 3.6-4.6 s on main), and at 10× none of four returned an image (one
  "the capture took longer than 20 s", three pending at 21-50 s). Two s2 changes to check: `img.decode()` on the
  whole-page SVG data URL before drawing (a second full decode of a large image), and the "working" beat, which is
  posted in the same task that starts the capture; the server still let three of them go pending. Suggested: measure
  the capture with and without `decode()` on the live console; have the server wait `SHOT_WORK_S` after a console
  says it is working, and never queue a screenshot for a wake (s1's own fix list).

## Found by the suite and left open (with the reason)

- **Four long-lived streams per tab** (`/api/events`, `/api/alerts/stream`, `follow-amber/stream`,
  `console-commands/stream`). Fine on HTTP/2 (live). On HTTP/1.1 (dev, `vite preview`, any proxy without h2) they take
  four of the six connections and the page's other calls queue. That makes the sandbox at HTTP/1.1 stall on every
  reload. Merging them into one event stream is a cross-plugin protocol change for its own build.
- **Startup still fires 36-94 `/api` calls in the first 10 s, and 13-43 are still unanswered at 10 s** in every tree.
  s3 spaces the plugin loads but not the calls each plugin makes in `register()`. The single uvicorn worker answers
  them one thread-pool slot at a time, and many start a node process. The home cards alone cost two node runs per
  card read (`plugin-commands/commands.mjs plan` + `finish`: 39 each per minute with three tabs open). This needs
  the s1 F2 single-flight helper applied to the control@1 read path. That is a server change across plugins, so it is
  left to a follow-up step.
- **Every control@1 read costs three node runs** (`token-control/control.mjs run`, then `plugin-commands/commands.mjs
  plan` and `finish`): about 40 of each per minute with three consoles open, from the Home cards and the control
  reads plugins make at startup. A shared read needs `plan` to be proven side-effect free for every plugin first
  (it gets the grants, the caller and the registry). That is a control@1 engine change, so it is left for its own
  step, with these numbers as the baseline.
- **The burst finds 5 routes that answer 5xx** (`console-control/state` and `/toolbars` 503 with no console connected,
  which is correct; `container-access/containers` and `snapshot-manager/containers` 502 because there is no Docker in
  the sandbox; `shipped-features/manifests` 500) and one that times out at 30 s (`crew-live/live`). The 500 and the
  timeout are worth a look. The rest come from the sandbox.
- **After ~20 minutes of use, the console starts missing commands.** Each command waits about 19 s and then goes
  pending ("the console didn't answer yet"). This happens in the commands section of the long runs but not in a fresh
  page (dbg run: 54/59). It matches s1 F1: a slow ack backdates the console's `lastSeen`, and the next commands skip
  it. s2 reworked the screenshot side of it. The plain commands (open, home, back, settings) still go pending after
  the dialogs section in every tree (see the commands rows above), so this part of F1 is still open.
- **Hard refresh does not reload within 20 s, and the console takes 24-38 s to come back.** Soft refresh is fine.
  `reloadPage(true)` first clears caches and unregisters service workers, after the ack. Not changed here: it needs a
  closer look in a real browser with the alerts service worker installed.
- **Some screens freeze the page for over 12 s** (the page could not paint a Playwright screenshot in 12 s): before:
  the startup page, UI Review, Token control (phone), Settings → Claude accounts and → Badges, and the Context menu
  designer filter, Fable rebuilds report, Plugin Manager window and What's shipped panel dialogs. UI Review's open also
  never answered in 20 s once, and "What's new" not in 30 s. Each of these is most likely a long synchronous render
  (a whole list drawn at once); each needs its own look with the browser's performance profiler.
- **Dialogs and tab rows that need a selection** (Plugin Manager's detail tabs, UI Review's item tabs, the glossary
  book tabs) are listed in the inventory and in `list dialogs`, but open nothing without an item. Expected. The
  inventory could mark them.
- **`view:sessions` (Session check-in) never opens**, though the inventory lists it.
- **The existing `scripts/console-control.e2e.mjs` fails on main** at "focus the build row" (the mocked build row is not
  on the Build orchestrator screen any more). It fails the same way on a clean `main` build, so it is not from this
  build.

## Checks run on this branch

- `npx tsc --noEmit` (console-web): clean.
- `node framework/cli/check-theme.mjs`, `check-controls.mjs`, `check-toolbars.mjs`: pass.
- `plugin-lifecycle.mjs check` for build-orchestrator, console-commands, theme-manager: clean. ui-review flags only
  the harness's local `.axf-focus.json` (not in git).
- `plugins/console-commands/server/test_console_commands.py`: 143 checks on this branch, 149 merged with s2.
- `scripts/settings-open.e2e.mjs`: 13 checks pass.
- `plugins/wake-listener/test.py`: 70 checks (2 new); `plugins/wake-listener/test.mjs`: 109 checks.
