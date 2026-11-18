# Guided live demo (demo-run@1, demo-act@1)

Brett, Nov 17 2026: "I want to watch these grids in real time. I want to watch it die, fail, and show what failed. I
want to see it cross off steps as it goes. Make a test so I can watch it in real time everything it can possibly do.
Give it at least 30 seconds between each thing. Give me an overlay before it starts with a button to continue or
pause. If I have pause between steps on, bring me to the focus of what I need to see and wait until I click next, then
another 30 seconds, and bring me to focus again."

A **demo run** is a scripted tour of everything the Build orchestrator can do, played on the live console against
throwaway builds so Brett can watch each thing happen in its grid: a build appears in Pending, is queued, dispatched,
ticks a step, crashes, is recovered by the watchdog, lands, is escalated, is deleted. The run shows an overlay first,
then for each **act** brings the console to the thing to look at, says what is about to happen, does it, records what
happened (pass / fail / skipped, with the evidence), crosses the act off the list, and waits at least 30 seconds before
the next one. With *pause between steps* on it also waits for **Next** after each act.

Reference core: `framework/core/live-demo.mjs` (pure, IO-free). Schema: `framework/schemas/live-demo.json`
(generated from the core by `node framework/cli/axf.mjs schemas`). Golden transitions:
`framework/spec/fixtures/live-demo.json`, replayed by `node framework/spec/check-live-demo.mjs` (CI).

The driver (the thing that really focuses the console, runs the act and records evidence) is a later phase; it reads
every decision from the core so the console overlay, REST, MCP, the CLI and voice all agree on what happens next.

## demo-act@1: one thing to watch

| field | type | meaning |
|---|---|---|
| `id` | slug, ≤ 60 | unique in the run; stable across runs so results can be compared |
| `title` | ≤ 120 | the line in the check-list that gets crossed off |
| `caption` | ≤ 400 | what Brett is about to see, shown over the focused element before the act runs |
| `focus` | object | where to look: `app`, `route`, `selector` (CSS), `address` (console-control@1 address, e.g. `row:demo-crash/step:s2`), `note` (the watch-live note). `app` is required; the rest are optional and additive |
| `run` | action | what the act does (below) |
| `expect` | expectation | what must be visible afterwards for the act to **pass** (below) |
| `cleanup` | action or `null` | undoes the act's side effects (delete the throwaway build, release the slot); runs after the result is recorded, never counted in the result |
| `builds` | list of build ids | every build the act touches. Each one **must** carry the `demo-` prefix (the demo sandbox, `framework/spec/BUILDS.md` → Demo builds); a run containing an act on any other build is refused at validation |
| `tags` | list of slugs | open: `grid`, `watchdog`, `lander`, `alerts`, `failure`, … for filtering the tour |

An **action** is `{ kind, cmd, args, method, path, body, timeoutMs }`: `kind` is one of `cli` (a repo command:
`cmd` + `args`), `rest` (`method` + `path` + `body` on the console API), `mcp` (`cmd` = tool, `body` = arguments),
`console` (`cmd` = a console-control@1 command on `path` = the address), `noop` (nothing: the act only focuses and
captions) or `custom` (the driver's own, named in `cmd`). `timeoutMs` ≥ 1000, default 60 000. Unknown kinds are
refused; the list may grow.

An **expectation** is `{ kind, build, step, status, text, within, fails }`: `kind` is one of `status` (the build's
status equals `status`), `step-done` / `step-skipped` (`step` on `build` is ticked / skipped), `row` / `row-gone`
(the build has / has no row in the grid), `banner` (a banner item whose text contains `text`), `note` (a build note
containing `text`), `alert` (an alert containing `text`), `log` (the run log contains `text`), `none` (nothing to
check: the act passes when its action returned) or `custom`. `within` (ms, default `run.timeoutMs`) is how long the
driver watches for it. `fails: true` says the act is **meant to die**: the pass is seeing the failure and what failed
(the crash act, the refused guard act), so a clean exit is the fail.

## demo-run@1: the record

| field | type | meaning |
|---|---|---|
| `$axf` | `demo-run@1` | |
| `id` | slug, ≤ 80 | one per run; the console deep link is `view:build-orchestrator/demo:<id>` |
| `title` | ≤ 200 | |
| `state` | enum | one of the states below |
| `pause` | boolean | *pause between steps*: wait for Next after every act (default **true**; Brett's toggle on the overlay and on the Next bar) |
| `minGapMs` | integer | the gap between acts, **≥ 30 000 and never lower**: any smaller value (or none) reads as 30 000; bigger is allowed (`MIN_GAP_MS`) |
| `acts` | `[demo-act@1…]` | the tour, in order; at least one |
| `cursor` | integer | index of the current act in `acts`, −1 before the first |
| `results` | `[act-result@1…]` | one per act done so far, in act order (the check-list's crossed-off lines) |
| `enteredAt` | ISO | when the current state was entered |
| `nextAt` | ISO or `''` | in `cooldown`: when the gap ends (`enteredAt + minGapMs`); otherwise `''` |
| `startedAt`, `endedAt` | ISO or `''` | first Continue; done or stopped |
| `stopped` | `{ at, by, why }` or `null` | who stopped it (brett / driver / error) and why |
| `createdAt`, `updatedAt` | ISO | |

An **act-result@1** is `{ actId, result, startedAt, endedAt, durationMs, observed, evidence, error }`:
`result` is `pass`, `fail` or `skipped`; `observed` is one plain line of what really happened ("exit 143, watchdog
retry 1"); `evidence` is a list of `{ kind, text, ref, at }` with `kind` one of `status`, `step`, `banner`, `note`,
`alert`, `log`, `shot`, `error`, `custom` (`ref` = a URL, a screenshot path or a console-control address); `error` is
the failure text or `''`. A skipped act has `observed` saying why (`stopped`, `skipped by brett`, `driver`).

## State machine

```
idle ──begin──► overlay ──continue──► focusing ──focused──► captioned ──start──► running
                  │                                                                 │
                  │ (pause on)   waiting-next ◄──────────── finish(result) ─────────┤
                  │                   │ next                                          │ (pause off)
                  │                   ▼                                               ▼
                  │               cooldown ◄──────────────────────────────────────────┘
                  │                   │ tick (at ≥ nextAt)
                  │                   ├─── more acts ──► focusing
                  │                   └─── no act left ─► done
                  └─ stop (from any state but idle / done / stopped) ──► stopped
```

| state | meaning | leaves on |
|---|---|---|
| `idle` | the run exists, nothing shown | `begin` → `overlay` |
| `overlay` | the start overlay: title, the act list, **Continue**, *pause between steps* toggle, Stop | `continue` → `focusing` (cursor becomes 0, `startedAt` set); `toggle-pause`; `stop` |
| `focusing` | the console is being brought to the act's focus target (watch-live follow) | `focused` → `captioned`; `skip` → `cooldown` (result skipped); `stop` |
| `captioned` | the caption is on screen over the focused element | `start` → `running` (result `startedAt`); `skip`; `stop` |
| `running` | the act's action is running and the driver watches for the expectation | `finish(result)` → `waiting-next` (pause on) or `cooldown` (pause off); `stop` (result skipped, `observed: stopped`) |
| `waiting-next` | the result is shown crossed off / failed with its evidence; waiting for **Next** | `next` → `cooldown`; `toggle-pause`; `stop` |
| `cooldown` | the gap: nothing happens until `nextAt` | `tick(at)` with `at ≥ nextAt` → `focusing` (next act) or `done` (none left); `toggle-pause`; `stop`. A `tick` before `nextAt` changes nothing |
| `done` | every act has a result | terminal |
| `stopped` | stopped early; acts without a result stay without one (the summary counts them as remaining) | terminal |

Timing rules:

- **Pause on:** `running → waiting-next` (wait for Next) `→ cooldown` (≥ `minGapMs`) `→ focusing`.
- **Pause off:** `running → cooldown` (≥ `minGapMs`) `→ focusing`.
- The gap is measured from entering `cooldown`; `nextAt = enteredAt + minGapMs`. The reference core never shortens
  it: a `tick` before `nextAt` is a no-op, an `advance` forced before it is refused with `too-early`.
- `toggle-pause` is allowed in `overlay`, `waiting-next` and `cooldown` and applies from the next finish on; it never
  moves the state.
- Every transition sets `enteredAt` to the event's time; every event carries `at` (ISO); an event without one is refused.

Invalid transitions (`DemoTransitionError`, `code`): `invalid-transition` (the event is not allowed in the state),
`too-early` (advancing a cooldown before `nextAt`), `no-act` (`focused` / `start` / `finish` with no current act),
`bad-result` (a `finish` whose result is not pass / fail / skipped), `bad-time` (an event without a valid `at`, or
earlier than `enteredAt`), `not-demo-build` (an act touching a build without the `demo-` prefix).

## Summary fold

`summarize(run)` folds the record into what the overlay shows at the end (and the Next bar shows all along):
`{ state, total, done, pass, fail, skipped, remaining, current, failed: [{ actId, title, observed, error }], startedAt,
endedAt, durationMs, pause, minGapMs }`. `done = pass + fail + skipped`; `remaining = total − done`; `current` is
the current act's id or `''`; `failed` lists every failed act with what failed, so the end overlay says *what* died.

## API (all four the same, a later phase)

Deep link `view:build-orchestrator/demo:<id>`; state readable at `GET /api/plugins/build-orchestrator/demo/<id>` <!-- axf-plugin:build-orchestrator -->
(the record + its summary); every event an action: `begin`, `continue`, `toggle-pause`, `focused`, `start`,
`finish`, `next`, `skip`, `stop`, `tick`, through REST, MCP (`build_orchestrator_demo_*`), `axf demo …` and voice.
The driver fires `focused` / `start` / `finish` / `tick` itself; Brett presses Continue, Next, Pause, Skip and Stop.

## Demo builds (the sandbox)

Every act touches only builds with the `demo: true` tag and the `demo-` id prefix (`framework/spec/BUILDS.md` → Demo
builds): the store refuses a demo action on any other build, and every projection, the dispatcher, the lander, alerts
and builds-live mark them demo-only, so a tour never queues, lands or notifies about a real build.

## Deferred

- The driver and the console overlay / Next bar (focus, captions, evidence capture, the check-list), REST, MCP, CLI and
  voice: the next phases of `guided-live-demo-test-watch-orchestrator`.
- Kotlin twin: none planned (console-only); recorded in `framework/spec/PORTING.md` when the driver lands.
