# Dev Console full audit: findings, ranked by impact

Build `fable-full-audit-ui-overhaul-conso`, step s1 (audit only; no code changed in this step).
Scope: `apps/console-web` web shell (`src/`), console server (`server/`), all 77 plugin folders (web + server parts).
Method: read the code paths behind the four reported symptoms end to end, scanned every server background thread and
every web poller, and checked the live console on the VPS (`axf-console` container, uvicorn pid 2759597, logs for the
last 3 hours, CPU per thread, request counts).

Each finding has: what is wrong, the evidence, the impact, and the fix proposed for a later step of this build. Fixes
are sized to land separately. Nothing is removed without the reason written here.

---

## P0: breaks a feature outright

### F1. `console_screenshot` never returns an image when the capture takes longer than 3.5 s (reported item 1)

**Where:** `plugins/console-commands/server/__init__.py` `_run` → `try_in_turn` (`LIVE_TRY_S = 3.5`) → `_nobody_answered`
→ `ack` late path; `run()` → `attach_shots`.

**What happens.** A screenshot goes down the same "recent console" path as `console_open`. Each live console gets
`LIVE_TRY_S` (3.5 s) to ack before it is written off as asleep. `console_open` acks in milliseconds. A screenshot acks
only after the tab has cloned the whole DOM, inlined every stylesheet into an SVG data URL, decoded it, encoded a PNG at
device pixel ratio (retrying smaller when over 4 MB) and uploaded it. On the console's size that is routinely more than
3.5 s. Then, with the usual single open console:

1. `try_in_turn` times out, backdates the console's `lastSeen` (so the *next* `console_open` also skips it until its
   next 15 s beat) and records the command in `_late`.
2. `_nobody_answered` treats `console.nav` as navigate-only, so it **queues the screenshot and wakes AmberX on Brett's
   phone at once** (`wake_after=0.0`), then waits `RETRY_WAIT_S` (15 s).
3. The desktop tab finishes, uploads the PNG (accepted: the id is still in `_acks`) and acks. The ack lands on the
   late path, which builds `e["result"]` **without `sent`**.
4. `run()` only calls `attach_shots` when `r.get("sent")` is set, so the answer comes back `status: delivered` with
   **no images**. The uploaded PNG is never read and is swept after 120 s.
5. If the ack is later than 15 s the call returns `pending`, and when the woken phone console says hello, `drain`
   sends it the screenshot as well; that result is stored on a queue entry nobody reads.

Contributing causes in the tab (`plugins/console-commands/web/index.tsx`, `web/capture.ts`):
- `runScreenshot` waits two `requestAnimationFrame`s before capturing. rAF never fires in a hidden tab, so a
  "recent" console that is in a background tab never answers at all.
- `capturePage` has no timeout: an SVG image that never fires `onload`/`onerror` hangs the command for ever.
- `markDone` runs only after the capture finishes, so a re-delivery during a slow capture runs a second capture.
- `pageCss()` inlines every rule of every stylesheet on each shot (the full console CSS, every plugin's), which is
  most of the cost.

**Impact:** high. Sessions cannot see the console (the tool exists, answers "delivered", carries nothing); each
attempt also opens the console on Brett's phone and marks the desktop console asleep, which slows the next commands.

**Fix (one slice):**
- Server: a per-command ack window. Screenshots (and `op: control`) get `SHOT_ACK_S` (about 20 s) on the first
  console instead of 3.5 s; never queue or wake for a screenshot (it is a read of *this* console's screen, not a
  navigation to replay elsewhere: return `failed` with the reason instead).
- Server: the late-ack path keeps `sent`, and `run()` attaches shots whenever the answer carries a screenshot message
  id, so a late but successful capture still returns its image.
- Tab: rAF with a `setTimeout` fallback (hidden tabs), an overall capture timeout (about 12 s) that acks a clear
  failure, mark the command as in progress before capturing, and only inline stylesheets that apply (skip rules for
  elements not in the cloned subtree when an element is captured).
- Tests: `test_console_commands.py` cases for a slow ack (image still returned), a late ack (image attached), and no
  AmberX wake for screenshots.

### F2. Console endpoints that shell out to `node` crash with 500 after 30-60 s under load (reported item 2)

**Where:** `plugins/build-orchestrator/server/__init__.py` `status_table` (60 s), `_priority` (30 s);
`plugins/project-switcher/server/__init__.py` `_cli` (60 s); the same pattern in about 55 plugin server files
(99 `subprocess.run/Popen/check_output` call sites in `server/` and `plugins/*/server`).

**Evidence (live log, last 3 h):** 9 unhandled `subprocess.TimeoutExpired` → `Exception in ASGI application` → 500:
`status-table.mjs --landed --json` ×3 and `--json` ×1 (60 s), `build-priority.mjs list --sources` ×4 (30 s),
`projects.mjs state` ×1 (60 s). Run by hand on the host the same commands take 1.25-1.7 s and about 190 MB RSS each.

**What happens.** Every request to these endpoints starts a fresh Node process (about 1.3 s CPU and 190 MB each).
The caches in front of them (`_table_cache`, `_priority_cache`) are not single-flight: N concurrent requests during
a cache miss start N node processes. On a busy VPS (load average 7-9 while builds run) a node process can wait long
enough to hit the timeout; `TimeoutExpired` is not caught in these two handlers, so the request holds a threadpool
thread for 30-60 s and then returns a raw 500.

**Impact:** high. On refresh the Build orchestrator table and every priority tag stall for up to a minute, then fail;
meanwhile the occupied threads slow every other sync endpoint on the console (one uvicorn worker, one shared
40-thread pool).

**Fix (one slice):** a small shared helper in `server/` (exposed to plugins through `plugin_services`, so plugins do
not import each other) that runs a CLI with: single-flight per key (one process per cache miss, the other callers wait
for its result), a stale-while-revalidate cache (serve the last good answer at once, refresh in the background), a
catch for `TimeoutExpired`/`OSError` that returns a structured error (503 with the reason) rather than a crash, and a
cap on concurrent node CLIs (a semaphore of about 4). Apply it first to the build-orchestrator table and priority
routes and project-switcher, then to the other startup-time routes listed in F3.

### F3. Startup fires every banner plugin and its first calls at once (reported item 2)

**Where:** `src/pluginLoader.tsx` `start()` and `src/lazyEngine.ts` `startupList`, `KNOWN_BANNERS`.

**What happens.** On every load the shell loads, in parallel (`Promise.allSettled`): all 24 banner plugins, the core
plugins on start, 5 most-used plugins, and every plugin whose web part hash changed since the last visit ("learn":
after a deploy that touched many plugins this is most of the 77). Each banner's `register()` and mounted component do
their first fetches straight away. The live log shows the burst: 29-30 API requests per 10 s window right after a page
load, against one uvicorn worker where many of those endpoints spawn node (F2) or ssh (Terminal `headless`, `nav`).

**Impact:** high. This is the "console hangs on refresh": the banner waits on the slowest of ~25 plugins, and their
calls queue behind each other and behind F2's slow node CLIs.

**Fix (one slice):**
- Load banners in small waves (a concurrency limit of about 4 in `group()`), most visible first, and keep "learn"
  loads for idle time (`requestIdleCallback`), not the startup group.
- A startup budget in the loader: plugin first fetches after the first paint, spread with a small jitter.
- Server side, F2's single-flight helper so the duplicate first calls from several banners (and several tabs) cost one
  process.

### F4. Stale `index.html` after a deploy loads a bundle that no longer exists (reported item 2)

**Where:** `server/main.py` `spa()` serves `index.html` through `FileResponse` with no `cache-control`.

**Evidence:** `GET /assets/index-CCrJ2Y6M.js` → 404 three times in the live log at 03:29-03:30, after a deploy.

**What happens.** Without `cache-control` the browser may reuse a cached `index.html` heuristically. Vite empties
`dist/assets` on build, so the old entry chunk is gone and the page stays blank or half-loaded until a hard refresh.

**Impact:** high for the person hit (a dead console after every deploy until a hard refresh); cheap to fix.

**Fix (one slice):** `cache-control: no-cache` on `index.html` (and the SPA fallback) so it is always revalidated;
optionally keep the previous build's `assets/` for a day so open tabs can finish loading their lazy chunks.

---

## P1: wasted CPU and background load (reported item 4)

### F5. Orchestrator demo: an always-mounted poller that spawns two node processes every 5 s per tab (reported items 3 and 4)

**Where:** `plugins/orchestrator-demo/web/CaptionBar.tsx` (slot `app.frame.cover`, `useDemoState(1000, 5000)`);
`plugins/orchestrator-demo/server/routes.py` `state()` runs `runner.mjs state` and `runner.mjs settings` per request.

**What happens.** Once the plugin's web part is installed (opened once, idle preload, or the "used" preload), its
caption bar polls `GET /state` every 5 s for as long as the tab is open, even when no demo is running. Each poll is two
node processes (about 2.5 s CPU, 2 × 190 MB). Two open tabs keep about one core busy for nothing. This matches the
"~99% of a core" report.

**Impact:** high CPU for a feature that is a scripted product demo, `enabledByDefault: true` on the live console.

**Fix:** the plugin stays installed (it is a real feature Brett asked for: a guided demo of the orchestrator), but:
- `enabledByDefault: false`, and the Plugin Manager entry says it is a demo tool.
- The caption bar polls only while a run is live; idle, it checks once on load and listens for a start (or polls
  every 60 s at most), and never when the tab is hidden.
- `state()` answers from one runner call (state and settings together) behind F2's cache.

### F6. Other recurring server work worth bounding

These are not runaway loops (each sleeps between rounds), but together they are the console's background load:

| Loop | Cadence | Cost per round | Note |
|---|---|---|---|
| Terminal nav websocket (`console-terminal` `nav_ws` ticker) | every 3 s per open terminal rail | `tmux ls` in the console (not cached) + connections read; VPS `tmux ls` cached 8 s | cache `console_tmux` for 3 s and share one model between sockets |
| Terminal `headless` poll (web `headless.ts`) | every 5 s per visible tab | ssh `tmux ls` cached 8 s | fine; skip when the rail is hidden |
| `crew-live` stream | every 2 s per open Crew view | cached snapshot | fine |
| `output-recorder` transcripts | back-to-back with 2 s gaps while a backlog exists | whisper, 2 threads, `nice 19` | bounded by `MAX_TRIES`; fine |
| `plugin-commands` MCP sync, `github-app` keeper, `maintenance` monitor, `claude-settings` clock, `systems-check` health (15 min), `ai-keys` refresh (10 min), `chat-viewer` sync, `app-catalog` | 1-15 min | small | fine |

Measured now: uvicorn averages 7.9% of a core over 1 h 43 min, 23 threads, no thread spinning. No unbounded
`while True` without a sleep or blocking wait was found in `server/` or `plugins/*/server`.

**Fix:** the Terminal cache above (small slice). The rest needs nothing.

---

## P2: dead code, demo code and leftovers (reported item 3)

### F7. Leftovers

| Item | What it is | Proposal |
|---|---|---|
| `plugins/notes-tasks/` | design doc, schema and a test, no `plugin.json`, `install.mjs` or web part: not a plugin, but sits in the plugins folder | move the design and schema to `_claude/plans/` (keeps the work), remove the folder; the loader already skips it, the plugin lifecycle checks do not |
| `/opt/axf/.axf-console/plugins/{auto-browser,molly,push-banner}` | data folders of plugins that no longer exist in the repo | remove through the uninstall path (or archive), report each |
| `plugins/project-wizard/` | no `install.mjs`/`uninstall.mjs` (plugin rule: every plugin ships both) | add them |
| `apps/console-web/src/axf/core` vs `framework/core` | 10 files differ and 4 framework modules are missing in the console copy (`demo-build`, `live-demo`, `phone-connect`, `pipeline-status`); the one difference read (`control-rules.mjs`) is doc text; the other nine are not yet read | re-sync the vendored copy through the framework sync, and add a CI check so it cannot drift again |
| orchestrator demo | real feature, but should not run on the live console by default | F5 (kept, off by default, no idle polling) |
| `plan-studio` and `plan-studio-2` | two planning plugins, both enabled | not dead: two different data models (plan@1 and plan-tree@1). Kept; noted only |
| `whats-shipped` and `shipped-features` | banner ticker vs full list | not duplicates. Kept |

No other demo code was found running on the live console: `framework/core/demo-build.mjs` and `live-demo.mjs` are
used by the real build engine (demo-* builds the orchestrator demo creates) and only act when a demo run asks.

---

## P3: other bugs found (reported item 5)

### F8. `phone-connect` device hello retried with a rejected token

`POST /api/plugins/phone-connect/device/hello` → 401, 73 times in 2 h (one device, about every 100 s). The console
side is correct (it refuses); the device keeps retrying a revoked or old credential. Proposal: the 401 answer says
"re-pair" in a machine-readable code, and the systems check shows one banner item ("a phone is trying to connect with
an old key: re-pair it in Settings → Plugins → Phone connect") instead of silent retries. The Android twin is a
deferred gap (no new Android work).

### F9. The SPA fallback answers unknown `/api/...` paths with `index.html` (200)

`spa()` returns `index.html` for every path that is not a file, including a mistyped or removed `/api/...` route. The
browser then fails on `r.json()` with an HTML parse error instead of a 404, which hides the real cause. Proposal:
`/api/*` and `/mcp*` paths that reach the fallback get a JSON 404.

### F10. `ack` of a late command can be lost when the queue entry already moved on

In `console-commands` `ack`, a late ack only settles the queued copy while it is still `queued`. If `drain` already
took it (`delivering`) the late ack is dropped and the command can run twice (once on the sleeping tab, once on the
new one). This only affects navigate-only commands (the only ones queued), so the cost is a duplicate navigation.
Proposal: covered by the F1 slice's tests; mark the late result on the entry in any state and let `drain` skip it.

---

## Proposed fix order (one landable change each)

1. F1 console screenshots: per-command ack window, no wake for screenshots, late ack keeps the image, tab-side
   timeouts and hidden-tab fallback. Tests.
2. F4 `index.html` `no-cache` (+ F9 JSON 404 for `/api`). Tests.
3. F2 shared single-flight CLI runner with timeout handling; applied to build-orchestrator table/priority and
   project-switcher. Tests.
4. F5 orchestrator demo: off by default, no idle polling, one runner call per state read.
5. F3 startup waves in the plugin loader, learn loads at idle. Unit tests for `startupList` and the wave limiter.
6. F6 Terminal `console_tmux` cache.
7. F7 leftovers: notes-tasks folder, orphan data dirs, project-wizard lifecycle files, vendored core re-sync.
8. F8 phone-connect re-pair banner item.

Each slice is small and independent; F2's helper is the only shared piece (F3 and F5 benefit from it but do not
depend on it to land).
