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
