# Fix: a phase-done build with steps left goes back to Pending instead of the Queue

Build: `fix-build-whose-session-finishes-phase-e`

## Notes

### s1: repro and code path

**Path from session exit to Pending**

1. `deploy/claude-headless.sh:431-432`: when `claude -p` exits, the wrapper writes `session-end` with the exit code to
   `events.jsonl`. A session that stops at the end of its phase, as the brief tells it to ("stop at the end of this
   phase"), exits **0**.
2. `apps/console-web/plugins/build-orchestrator/pipeline.mjs:478` `checkEnds()` (runs in the dispatcher tick) finds
   that event for the running build and calls `P.endOutcome(b, { exit, … })` (line 496).
3. `apps/console-web/plugins/build-orchestrator/pipeline-core.mjs:351` `endOutcome()` decides whether the run ended at
   a phase boundary like this:
   ```js
   const phaseSwitch = stepsLeft > 0 && !!b.pipeline?.model && nextModel(b) !== b.pipeline.model;
   ```
   So a phase only counts as ended when the **model** changes. This does not match how a phase is defined.
   `web/orchestrator-core.mjs:154` `phases()` also starts a new phase when the **phase label** changes while the model
   stays the same (for example Fable "Schema" → Fable "Engine", or Opus "Phase 1" → Opus "Phase 2"). `phaseSwitch`
   is also false whenever `pipeline.model` is empty (a run not started by the dispatcher, or a record written before
   `model` was stored).
4. `framework/core/build-pipeline.mjs:163` `outcomeOf()`: with `exit === 0`, steps left and `phaseSwitch === false`,
   it returns `'returned'`. `STATUS_AFTER.returned = 'pending'` (line 168).
5. `pipeline.mjs:498` `setPipeline(…, { status: 'pending' })`. The crew line says "Brett, it needs you".
6. The build does not come back on its own either. `pipeline.mjs:402` `intake()` auto-queue skips any build whose
   `lastRun.outcome === 'returned'`, and `planTick` only launches `queued` builds (`pipeline-core.mjs:321`). The next
   phase never starts, and the slot stays empty until Brett queues the build again by hand.

**Repro** (pure, against the real `endOutcome` and `phases`, exit 0, one run):

| case | phases | outcome | status |
|---|---|---|---|
| A: Fable → Opus, `pipeline.model = 'Fable'` | Phase 1:Fable done, Phase 2:Opus open | requeued | queued ✓ |
| B: Opus "Phase 1" → Opus "Phase 2" | Phase 1:Opus done, Phase 2:Opus open | **returned** | **pending** ✗ |
| C: Fable → Opus, `pipeline.model = ''` | Phase 1:Fable done, Phase 2:Opus open | **returned** | **pending** ✗ |
| D: Fable "Schema" → Fable "Engine" | Schema:Fable done, Engine:Fable open | **returned** | **pending** ✗ |

**Root cause:** `endOutcome` guesses that a phase has ended by comparing models. It should instead ask whether the
phase the run was launched for is now done. The launch also does not record which phase it started
(`pipeline.mjs:629` stores `model`, not `l.phase`), so the end handler has nothing to compare against.

**Fix direction (next phases):**
- At launch, record the phase on the pipeline record (`pipeline.phase`, the phase name or index from `orchNextUp`).
- In `endOutcome`, set `phaseSwitch = stepsLeft > 0 && exit === 0 && (the launched phase is done in phases(b), or the
  first open phase differs from the launched one)`. Fall back to comparing models only for older records that have no
  phase recorded.
- Keep `returned` (Pending) for a session that stops mid-phase on purpose, such as a question or a UI Review wait.
  The build note from `act note` remains the signal for that case.
- Add tests B, C and D to `pipeline.test.mjs`. Twin `build-pipeline.mjs` copies under `apps/*/src/axf/core` regenerate
  from framework/core.

## Result (phases 2–3)

**Before:** a session that finished its phase (for example the Fable steps) and exited 0 with steps left went to
**Pending**. The next phase never started and the slots sat empty until Brett queued the build again by hand. Four
builds were stuck like this on Nov 16.

**After:** that build goes back to the **Queue at its place**, and the next phase **starts by itself** within seconds,
on a free slot and an account that runs the next phase's model. Pending only when Brett is needed: the crash limit, an
unapproved upgrade, the session asked for him, or it stopped mid-phase.

### What changed

| step | change |
|---|---|
| s2–s3 | build-pipeline@1 `nextStatusOnExit()`: the exit transition with reasons (`phase-done`, `crash`, `crash-limit`, `upgrade-blocked`, `needs-brett`, `stopped`, `all-done`). The crash limit counts crashes, not sessions. The launch records its phase. Golden cases. |
| s4 | `pipeline.mjs` `endRun()`: the session-exit handler writes that result through the builds store, journalled as "phase <n> done, requeued for <model>" (`pipeline:requeue`). |
| s5 | `pipeline.mjs exit <id>` (`onExit()`): ends the run now and runs one dispatcher tick in-process, under the cron's `flock` lock, so nothing launches twice. |
| s6 | `deploy/claude-headless.sh`: reports the exit kind (`phase-done` / `crash` / `stopped`) and the phase on `session-end`, then calls `pipeline.mjs exit` (detached, clean env) once its slot is free. The cron tick reads the same event as the fallback. |
| s7 | `pipeline.mjs requeue-stuck [--apply]` + `builds-reconcile.mjs --apply` move builds parked by the old rule back to the Queue. |
| s8 | Pipeline tab: "Next phase: <model>, waiting for slot/account" on a requeued build; a wrongly parked Pending build says why, and its button reads **Back to Queue**. |
| s9 | REST / MCP / voice / CLI / console action for requeue-stuck; `requeue` and `stuck` on every pipeline row. |
| s10 | Dispatcher integration test with a fake launcher (two-phase Fable → Opus, double report, crash and crash limit, mid-phase stop, requeue-stuck). |
| s11 | `_claude/builds/README.md` rule, new `apps/console-web/plugins/build-orchestrator/README.md`, help entries. |

### How each API is reached

| what | REST | MCP / AmberX voice | CLI | console |
|---|---|---|---|---|
| requeue reason + next phase | `GET /api/plugins/build-orchestrator/pipeline` (rows: `requeue`, `stuck`) | `pipeline-status`, `pipeline-tab` | `pipeline.mjs status --json`, `show <id>` | Pipeline tab line |
| requeue-stuck | `POST …/pipeline/requeue-stuck` `{apply}` | `pipeline-requeue-stuck` ("requeue the stuck builds") | `pipeline.mjs requeue-stuck [--apply]` | action `build-orchestrator.requeue-stuck[:apply]`, **Back to Queue** |
| a build's pipeline row | – | `console_show build-orchestrator <id>` | – | action `build-orchestrator.open:<id>` |
| session exit | – | – | `pipeline.mjs exit <id> --kind … --phase …` (the wrapper calls it) | – |

All four surfaces call the same `requeueStuck()`.

### Repair run

`pipeline.mjs requeue-stuck --apply` on Nov 16 moved 4 builds back to the Queue:
`ui-manager-floating-window-to-select-any` (next Fable), `demo-video-series-three-minute-browser` (next Fable),
`console-look-becomes-default-axhub-skin` (next Opus), `vps-sends-shipped-features-every-merge` (next Opus).

### Checks

`pipeline.test.mjs` 53/53, `check-build-pipeline` 154/154, `check-builds-store` 40, `builds-store verify` ok,
`check-plugin-commands` ok, `check-console-commands` 101, `check-theme` / `check-controls` ok, `help-coverage --check`
100 %, glossary `catalog --check` complete.

**Not done:** Pipeline tab shots. There is no web capture tool in the repo, and the live console runs main, so a shot
would not show this branch. Take them after merge (they were non-blocking).
