<!-- memory-chunk@1 source=_claude/memory/docs/feature-matrix.md lines=70-78 tokens=150 -->
### What changed in the other cores (all additive)

- `orchestrator@1` (`orchestrator-core.mjs`): steps carry `skip`; skipped steps leave `minutesLeft`, `nextUp`, phase
  completeness and the brief (`[skip]`); `progress().skipped`, `group.skipped`; new action `skip-step { id, step, skip }`.
- `pending@1` (`pending-core.mjs`): sub prompts keep `skip` and `fm`; `entryMinutes`, `splitCheck`, `stepsProgress`
  count only unskipped steps.
- `build-queue@1` (`build-queue-core.mjs`): small steps keep `skip` and `fm` (recordSteps + stepsAction).
- `change-log@1` (`changes-core.mjs`): steps keep `fm`.
