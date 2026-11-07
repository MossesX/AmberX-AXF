# Every build has a plan (build-plan@1)

Brett, Nov 7 2026 (voice): "Go retro. Go back to all the builds we've started in the last 12 hours. Make the plan, put
them in Plan Studio and check off their statuses, all the steps, each individual step that's completed."

## What it is

Every build has a Plan Studio plan: what Brett said, the brief, every addendum, the steps with ticks, the status, and links
to the build, its pending item, branch and PR.

The plan is a **view of the build's record** in the builds store (`managed: 'build'`). It is made again on every sync, so
there is no second copy. Text Brett adds around the block, comments, and steps only the plan has stay his.

- Step ids: store step `s7` = `<build>-7`; an addendum's sub-step `s7-2` = `<build>-7-2`.
- Stages: Planned, Paused, Running, Waiting, Blocked, Failed, Built, In merge queue, Merged, Archived.

## Addenda are check-off items

Each addendum on a build is a step `sK` (`addendum: N`) with sub-steps `sK-1`… (`parent: 'sK'`). They are real steps, so the
orchestrator ticks them like any other. The item ticks itself when its last sub-step is done, and shows Brett's words,
Claude's summary and the sub-steps. Check-off items don't hold a build open: `liveStatus` looks at its own steps.

Ways in, all ending in the same steps:
- A brief's `## Addendum N` block. Quoted words followed by a list: the list is the summary and the sub-steps.
- `orchestrator.mjs act '{"action":"addendum","id":…,"said":…,"summary":…,"steps":[…]}'`
- `build-origin.mjs addendum <id> --said "…"` and `POST /origin/{id}/addendum`.

## How it flows

- **Launch:** `deploy/claude-headless.sh` (so axHub `build_start` and console launches) runs `framework/cli/build-plan.mjs
  ensure`. A brief starting `# Build: <id>` with no record gets one, then its words, addenda and plan.
  `AXF_BUILD_PLANS=off` skips it. Job briefs (`# Job:`) make no plan.
- **Ticks:** `orchestrator.mjs act` pushes to the plan in a child process. Opening Plan Studio syncs every plan too.
- **Tick in Plan Studio:** goes to the orchestrator (`op: tick`), never into the plan alone.
- **Older builds:** `node apps/console-web/plugins/plan-studio/backfill.mjs --map <file> [--dry-run]`. Safe to re-run.

## Foreign files can't hurt a build

A foreign file is an export written by another checkout or an old hub copy. It may add steps and move a build forward.
It never moves a status back, drops a step, takes a tick back or brings back a deleted build. Merging two copies treats
the same words under new uids as one step and keeps a step the newer copy never saw, unless it recorded removing it.

## Checks

`node framework/spec/check-build-plans.mjs` (CI). Report: `_claude/builds/reports/plan-studio-backfill-12h.md`.
