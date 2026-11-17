# BUILD-LIVE — build-live@1: build changes and liveness on the console live channel

Status: contract since Nov 17 2026 (build `live-build-status-real-time-grids-15`, Fable phase). Brett, Nov 17 2026:
"Every time something happens, I want the console to be updated in real time. The VPS checks every 15 seconds to make
sure the jobs are running and updates the console. Every running job in any grid has a spinning or animated icon, and
building rows flash slowly; configure the animation, flash, pulse, colors. When it stops it goes red, a pink background
with a pop-up alert that says broke, and a dialog shows what happened."

Reference engine: `framework/core/engines/build-live.mjs` (normalise, validate, fold events into per-build live state,
the broken rule, dedupe; `jsonSchema()` writes the schema). Schema: `framework/schemas/build-live.json`
(`build-live-event@1`, `build-live-state@1`, `build-live-snapshot@1`). Fixture: `framework/spec/fixtures/build-live.json`
(`spec/check-build-live.mjs`, `--write` regenerates the `out` blocks). Kotlin twin deferred (PORTING.md).
Run indicator (the animation, colours and reduced-motion fallback a row draws with): asset type `run-indicator`,
engine `framework/core/engines/run-indicator.ts`.

## What it is for

The Build manager's grids (Pending, Queue, Building, the Watchdog panel, Home cards) read the builds store on a reload.
Between reloads a build can tick a step, crash, be requeued by the watchdog or land, and the console shows none of it
until someone presses Reload. build-live@1 is **the one event the console's grids follow**: every builds store change
and every liveness pass the VPS makes is pushed as one small record on the console live channel, and one pure engine
turns the stream into a live state per build (running, stale, broke, done) that every grid row, the alert pop-up and
the "what happened" dialog draw from. The same state is readable without the UI (REST, MCP, CLI, voice), so a phone
and a grid say the same thing.

Liveness **reuses the two watchdogs' verdicts and adds no check of its own**:

- the recovery watchdog (build-watchdog@1, `framework/core/build-watchdog.mjs`, `#772`): its `causeOf` names why a
  build marked Building is alive, starting, stale or gone (`live`, `starting`, `stale-heartbeat`, `pid-gone`,
  `tmux-missing`, `exit-*`, `usage-limit`, `auth-failed`, `unknown`), and its `decide` says what it is doing about it
  (`retry`, `requeue`, `kill-retry`, `retry-other-account`, `give-up`, `none`);
- the stale-row watchdog (stale-row@1, `framework/core/stale-rows.mjs`, `#780`): its `classify` says whether a row
  should still be on its list (`keep` / `complete` / `remove` + reason).

The 15-second pass (the VPS, `AXF_LIVENESS_SEC`, default 15) probes every build marked running the way the recovery
watchdog does (`probeBuild`), runs `causeOf` on the probe and publishes the answer as a `liveness` event. It never
decides a recovery itself: that stays the recovery watchdog's one-minute pass, which publishes a `watchdog` event when
it acts. A stale-row verdict rides along on the event when that watchdog looked at the row since the last pass.

## Channel

The console live channel is the console's server-sent event stream (`framework/core/sse.ts` framing: `id:` = `seq`,
`event:`, `data:` JSON). Every build-live@1 record is one frame:

```
id: 4812
event: build-live
data: { "$axf": "build-live-event@1", "seq": 4812, "kind": "liveness", "build": "skins", … }
```

- Route: the console's `/api/events` stream (the orchestrator plugin publishes through the console's `log` bus with
  `event: build-live`), and the plugin's own `GET /api/plugins/build-orchestrator/live/stream` (the same frames, only
  this plugin's). A client that reconnects sends `Last-Event-ID`; the server replays from the ring buffer (last 2000
  frames, `LIVE_RING`) or, when the id is older than the ring, sends one `snapshot` event per build first.
- Read without the stream: `GET /api/plugins/build-orchestrator/live` → `build-live-snapshot@1`
  (`{ $axf, at, seq, everySec, builds: build-live-state@1[] }`), `GET …/live/<build>` → one state. MCP
  `build-orchestrator_live` and `axf builds live [<build>] [--json] [--follow]` return the same document; AmberX voice
  reads `line` of each state ("skins is broke: session killed, exit 143, retry 1 of 3").
- Deep link (console_show target): `view:build-orchestrator/row:<build>`; the dialog: `dialog:build-live/<build>`.

## Records

### build-live-event@1

| Field | Type | Meaning |
| --- | --- | --- |
| `$axf` | `build-live-event@1` | |
| `id` | `<build>:<kind>:<seq>` ≤ 200 | stable: a replayed frame has the same id, so a listener is idempotent |
| `seq` | integer ≥ 1 | channel-wide, monotonic on the publishing host; the SSE `id:` |
| `kind` | `change` \| `liveness` \| `watchdog` \| `snapshot` | **change** = a builds store write touched the build (one per build-event@1); **liveness** = the 15-second pass looked; **watchdog** = the recovery watchdog acted; **snapshot** = the full state of one build, sent on connect / reconnect and when a client asks |
| `build` | `^[a-z0-9][a-z0-9-]{0,79}$` | the build id |
| `title` | string ≤ 160 | the build's title ('' when unknown) |
| `at` | ISO date-time | when it happened (the store write, the probe, the recovery) |
| `by` | string ≤ 80 | who produced it: `liveness` (the 15-second pass), `watchdog`, `store:<by>` (the store writer: cli, console, mcp, headless, …), `snapshot` |
| `status` | builds@1 status | the build's status after the event |
| `step` | `{ id, title, phase, index, total }` \| null | the step the build is on: the first open step (`index` 1-based, `total` = every step); null when none is open |
| `lastStep` | `{ id, title, doneAt }` \| null | the newest ticked step; null when none |
| `alive` | `alive` \| `stale` \| `dead` \| `unknown` \| `none` | the liveness verdict (see the table below); **none** = the build is not marked running, there is nothing to check |
| `cause` | build-watchdog@1 cause \| `''` | why (`live`, `starting`, `stale-heartbeat`, `pid-gone`, `tmux-missing`, `exit-clean`, `exit-killed`, `exit-oom`, `exit-failed`, `usage-limit`, `auth-failed`, `unknown`); '' when alive is `none` |
| `exit` | integer \| null | the exit code recorded for the current session (null = none) |
| `signal` | string ≤ 8 | the signal name for that exit (`TERM`, `KILL`, …) or '' |
| `watchdog` | `{ action, attempt, note, at }` | what the recovery watchdog is doing: `action` is a build-watchdog@1 action or '' (nothing), `attempt` the retry count, `note` its plain-words line, `at` when it decided ('' = never) |
| `stale` | `{ action, reason }` \| null | the stale-row@1 verdict on the build's row when that watchdog looked (null = it did not) |
| `change` | build-event@1 event \| `''` | for `kind: change`: which store event (`step-done`, `status`, `pr-opened`, …); '' otherwise |
| `everySec` | integer 5–300 | how often the liveness pass runs (15); on `liveness` and `snapshot`; a client that sees none for 3 × everySec shows the channel as stale |
| `note` | string ≤ 400 | one plain line for the row's tooltip and the dialog |

Every field is present after `normEvent`; a raw frame may leave optional ones out. Junk never throws: an unknown kind,
a bad build id, a missing `at` or `seq` make `normEvent` return null and `validateEvent` list the fields.

#### The liveness verdict (`aliveOf`)

| build-watchdog@1 cause | alive | meaning |
| --- | --- | --- |
| build not marked running | `none` | nothing to check: pending, queued without a launch, built, landing, landed, complete, … |
| `live`, `starting` | `alive` | a process, a tmux session or a fresh heartbeat; or launched inside the grace |
| `stale-heartbeat` with a process alive | `stale` | hung: alive but silent past `staleMin` (the watchdog will kill-retry) |
| `unknown` | `unknown` | the probe has not looked yet (every signal null) |
| every other cause | `dead` | the session is gone: exit recorded, process and tmux gone, heartbeat stale with nothing alive, the account's limit or login |

### build-live-state@1 (the fold)

The engine folds events for one build into one state, newest wins:

| Field | Type | Meaning |
| --- | --- | --- |
| `$axf` | `build-live-state@1` | |
| `build`, `title`, `status`, `step`, `lastStep`, `alive`, `cause`, `exit`, `signal`, `watchdog`, `stale` | as the event | the newest value of each |
| `state` | `idle` \| `running` \| `stale` \| `broke` \| `done` | the row's live state (the rule below) |
| `broke` | `{ at, cause, exit, signal, what, recovering }` \| null | set when the row went broke: `what` is the plain line the alert and the dialog show, `recovering` true while the watchdog has an action other than none / give-up on it |
| `recovering` | boolean | the watchdog is on it (retry, requeue, kill-retry, retry-other-account) |
| `at` | ISO | the newest event folded |
| `checkedAt` | ISO \| `''` | the newest liveness pass folded (moves even when nothing changed) |
| `seq` | integer | the newest seq folded |
| `events` | integer | how many events were folded (dropped repeats not counted) |
| `line` | string ≤ 300 | one plain line: "skins · running · s3 of 6 · alive", "skins · broke · session killed (exit 143) · watchdog: retry 1 of 3" |

#### State rule (`stateOf`), first that fires wins

1. status `failed`, `escalated` or `blocked` → **broke**
2. watchdog action `give-up` → **broke**
3. the build is marked running (status running / waiting / fixing, or `alive` ≠ `none`) and `alive` is `dead` → **broke**,
   unless cause is `exit-clean` (a clean phase end the store has not processed yet: the row stays **running** until the
   `change` event moves it on)
4. marked running and `alive` is `stale` → **stale**
5. marked running (alive `alive`, `unknown`, or no liveness yet) → **running**
6. status `built`, `landing`, `landed` or `complete` → **done**
7. otherwise (pending, queued, archived, nothing running) → **idle**

Account stops (`usage-limit`, `auth-failed`) are **broke** too: the session stopped, the row goes red and the alert says
so; `recovering: true` and the watchdog's note ("the build is fine, it goes back to the Queue for another account") are
what the dialog shows. A later `change` event that moves the status back to `queued` clears `broke` (state → idle) but
keeps the last `broke` block on the state as `lastBroke` so the dialog still opens on what happened.

#### Dedupe (`fold`)

- an event whose `id` was already folded is dropped;
- an event older (`at`) than the state's newest event of the same kind is dropped (out-of-order replay);
- a `liveness` event that changes nothing the state shows (status, step id, alive, cause, exit, watchdog action,
  stale verdict) only moves `checkedAt` and `seq`; `fold` returns `{ state, changed: false }` so the grid does not
  re-render and the row's animation does not restart;
- a `snapshot` replaces every field (it is the full state), never dropped unless older.

`foldAll(events)` folds a whole stream into `Map<build, state>` (replay); `snapshot(states, at, seq)` wraps them as
`build-live-snapshot@1`.

## The 15-second pass

`node apps/console-web/plugins/build-orchestrator/recovery-watchdog.mjs liveness [--json]` (added by the Opus phase):
every `everySec` seconds on the VPS (a `while` loop under the watchdog's flock, not a cron minute), for every build
`isMarkedRunning`: `probeBuild` → `causeOf` → one `liveness` event. The pass never recovers, never writes the store,
never pushes a phone notification; it publishes. When the pass itself stops, the client sees no liveness for
3 × everySec and shows the channel stale (the systems check has a `build-live` item: "Liveness pass silent since …",
Auto fix restarts it).

## Where the UI reads it (later phases)

Every grid row reads its build's `state` and draws the `run-indicator` asset's tokens: `running` → the animated icon
and the slow flash; `stale` → the icon still, the row dimmed; `broke` → red text on the pink (danger tint) background,
one alert "<title> broke" (alert hub, source `build-live`, notify type `build-live.broke`, pushed once per `broke.at`),
and the dialog `dialog:build-live/<build>` showing `broke.what`, the cause, exit and signal, the watchdog's note, the
last step and the events since the last change. `done` → the done tone; `idle` → nothing.

## Checks

`node framework/spec/check-build-live.mjs` replays the fixture (events: `normEvent` / `validateEvent`; `invalid`: the
error fields; `fold`: sequences → state + changed flags), checks `framework/schemas/build-live.json` equals
`jsonSchema()`, and that every cause and action named here is one build-watchdog@1 / stale-row@1 knows.
