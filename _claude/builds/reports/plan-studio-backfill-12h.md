# Plan Studio backfill: report

Build `plan-studio-backfill-12h` (Current profile), Opus, agent Reel Rhonda, branch `claude/plan-studio-backfill-12h`, Nov 7 2026.

## What Brett said

> Go retro. Go back to all the builds we've started in the last 12 hours. Make the plan, put them in Plan Studio and check
> off their statuses, all the steps, each individual step that's completed.

Addendum 1 (voice): any change to a plan goes into Plan Studio as a sub-step: his words verbatim, Claude's summary, then
steps to cross off; every change goes through the orchestrator, which ticks them.

## The bug (token-usage-log-accounts-plan-studio-control)

It was not in Plan Studio's own sync. The journal shows what happened to the build and its `-small-steps` twin on Nov 6:

| UTC | What | Effect |
|---|---|---|
| 14:13 | Amber archived the 31-step item | status `archived` |
| 14:30 | A checkout's store took in the hub's `pending.json` as a foreign file | the item came back `complete`; the twin was re-made with new step uids |
| by 18:01 | Two copies merged by uid | 55 steps became 110 |
| 18:15 | token-optimize ticked 19 steps | 19/110 |
| 20:16 | The reconciler wrote a copy with the doubled steps dropped | 19 ticks gone, `running` back to `pending`, 55 `removedSteps` |

Causes, all fixed:
- `absorbPending` / `absorbOrchestrator` took a file marked newer at its word: status, steps and ticks.
- A build re-made from a foreign file got random uids, and `mergeBuild` matched steps only by uid.
- `mergeBuild` treated a step the newer copy had never seen as removed.
- `turnIntoBuild` wrote a whole orchestrator export back, the same kind of foreign write. It now goes through the store lock.
- `syncBuild` forced every linked plan to `building`, called a plan done before its PR merged, and ignored steps added on
  the build.

Now a foreign file only moves a build forward. It can't drop a step, take a tick back or bring back a deleted build.

## What was built

- **build-plan@1:** a plan is a view of its store record (`planFromBuild`, `managed: 'build'`). Steps `<build>-N`, addenda
  `<build>-N-M`, stage, links to build, pending item, branch and PR. Brett's own text, comments and steps are kept.
- **Addenda:** check-off items made of real build steps (`checkoffSteps`, `attachCheckoffs`, `tickParents`), orchestrator
  action `addendum`, the same steps from briefs and `/origin/{id}/addendum`.
- **Launch:** `deploy/claude-headless.sh` runs `framework/cli/build-plan.mjs ensure`, so axHub `build_start` and console
  launches are covered. A brief with `# Build:` and no record now gets one.
- **Ticks:** the orchestrator pushes to the plan; a tick in Plan Studio goes to the orchestrator.
- **Editor:** managed plans show read-only steps with ticks and each addendum in three parts; list and editor show the stage.
- `apps/console-web/plugins/plan-studio/backfill.mjs`, rerunnable. Docs `_claude/memory/docs/build-plans.md`.

## Backfill result

25 entries, 24 plans. Done / total at the end of the run, sub-steps included:

```
claude-accounts-edit                          planned ready 0/5 0 add
console-approvals-in-place                    paused building 4/22 5 add
headless-progress-file-lean-claude-md-chain   paused building 6/8 0 add
first-refresh-token-saved-every-time-it-s-us  merged done 1/1 0 add #359
token-usage-log-accounts-plan-studio-control  archived dropped 1/31 0 add
token-usage-log-accounts-plan-studio-control  paused building 19/55 0 add #360
assistant-chat-mode                           merge-queue building 8/8 0 add #361
headless-session-efficiency-shared-chain-con  merge-queue building 32/32 0 add #362
notes-tasks-sync                              merge-queue building 5/5 0 add #363
ui-review-notify-session-audio                merge-queue building 8/8 1 add #365
shipped-features-r2                           merge-queue building 22/22 6 add #364
fable-review-shipped-features-build-hook-con  merge-queue building 0/0 0 add #364
claude-badge-vps                              merge-queue building 9/9 2 add #366
notifications-control-panel                   merge-queue building 11/11 1 add #367
gizmo-voice                                   running building 2/3 0 add
gizmo-rebuild-fable                           merge-queue building 39/39 8 add #368
ui-registry-shortcuts                         merge-queue building 13/13 2 add #369
badges-notify-followup                        merge-queue building 14/14 3 add #370
claude-settings-tabs-veto                     running building 5/12 2 add #371
settings-sections-everywhere                  merge-queue building 7/7 0 add #372
amberx-open-any-url                           running building 0/4 0 add
axhub-google                                  running building 0/4 0 add
notes-tasks-calendar                          running building 0/15 3 add
plan-studio-backfill-12h                      running building 7/13 1 add
```

Evidence-only ticks written to the store: 19 restored on token-usage small-steps from the journal; 10 on shipped-features-r2
(status `built`, PR #364, it had none ticked); plus the addendum items of builds already built or merged.

Judgement calls, worth a look:
- `shipped-features-r2`: ticked because `built` means all steps done. No step-by-step evidence exists.
- Addendum sub-steps on built builds are ticked because the build finished after them, not because each was checked.
- Addenda with no list in the brief got one sub-step and no summary. No summary was invented.
- `md-chain-default` got no plan of its own: it was a follow-up pushed onto PR #362, and its brief has no verbatim block.
  It is NOT recorded as an addendum.
- `claude-accounts-edit` (r1 and r2): r2 reported success then hit the 5-hour limit; no PR. Record made as pending, 0/5.
- `today` and `approvals-in-place-r2` both belong to `console-approvals-in-place`.
- `amberx-open-any-url`, `axhub-google` and `notes-tasks-calendar` had no record; made from their briefs. The first two are
  axHub repo builds, so their ticks wait on those sessions.
- The older hand-made plan `token-usage-log-rules-briefs-api-run-approvals-3gcg` stays parked and separate.

## Known gaps

- **Re-run needed after this lands:** other sessions still run the old merge until then, and it can drop addendum steps on
  running builds. `backfill.mjs` puts them back (`attachCheckoffs` re-makes lost steps), but it needs the map file, which is
  in this report's folder.
- Running sessions don't yet tick addendum sub-steps on their own: the launcher does not tell them to. The rule is written;
  nothing enforces it. Open items don't hold a build open.
- Plan-only hand edits to a managed plan's steps come back from the store. That is the design.
- plan@1 and the store steps gained optional fields, built on Opus. The orchestrator would pin contract work to Fable: this
  should go through a Fable review.
- `build-todo-sync` (PR #333, unmerged) also makes a plan per build, with its own managed block. It clashes with this and
  needs reconciling before it lands. A note is on that build.
- `builds-live flush` kept saying "busy" here, though the build's record did reach main.

## Checks

check-build-plans 22 (new), builds-store 37, builds-live 47, build-origin 21, build-priority 8, store lock 5, build-steps 44,
orchestrator 33, plan-studio test.mjs 26 and test.py, theme, controls, `tsc --noEmit`, `vite build`: all passed locally.
The full CI sweep has not been run locally.
