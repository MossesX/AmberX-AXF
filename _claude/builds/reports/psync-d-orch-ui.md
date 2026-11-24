# psync-d-orch-ui: the Build orchestrator screen and the end-to-end test

Part D of 4 of build `pipeline-sync-live-badges` (its steps s7 and s8). Branch `claude/psync-d-orch-ui`, no PR of its
own: the four branches are combined into one PR, CI runs once.

## What Brett asked for

- "different badges for all the different steps, like waiting for the VPS to do this, waiting for it to do that,
  merging, waiting to merge"
- "give every build a number too, a unique ID that shows up in the orchestrator and the Plan Studio ... the steps ...
  need to show the unique ID of the step in its own column"
- "this one is waiting for this or that to merge ... you will say the order that they're going to be merged in"
- "I want the option to compile them all into one and merge them all together."
- "make sure it runs a test ... follow a build from split ... all the way to complete ... very small, but at least
  five steps."

## What was built

All in `apps/console-web/plugins/build-orchestrator/`.

| File | What it does |
| --- | --- |
| `web/pipeline-view-core.mjs` (+ `.d.mts`) | The pure rules: the 14 states with label, tone and plain line; the store's `pipelineView` wins field by field, anything missing is worked out from the build's status; waiting reason, merge line, split badge words, build number. |
| `web/status-table-core.mjs` (+ `.d.mts`) | Every table row now carries `number`, `view`, `split`, `splitLabel`; every step `uid`, `splitBy`, `split`, `modelBy`. `ensureViews()` fills them for rows from a server older than the screen. Find also matches the build number. |
| `web/StatusTable.tsx` | Build rows: **No.** column (build number), state badge, **Doing now** column (waiting reason linked to the holder, else the merge line linked to the build ahead, else the status line). Detail: number, badge, split badge, status line, waiting reason with an Open button, merge line with **Merge together**, facts. Steps: **Step ID** in its own column, **Triage model** ("not assigned yet" before the gate), **Split** badge. Phone: the same in the row and the expanded row. |
| `web/live.ts` | One `EventSource` on `/api/builds/events` for the page; every `builds.updated` re-reads the table. Closes with the last table. Gives up quietly on a server without the channel. |
| `web/mergeTogether.ts` | The "Merge together" call. |
| `web/index.tsx` | Console action `build-orchestrator.merge-together[:<build>,<build>]`; search shows the build number and state. |
| `web/status-table.css` | Layout and one colour per new state and tone, tokens only. |
| `test-pipeline-sync.mjs` | The end-to-end test (below). |

Live refresh: `builds.updated` event, window focus, tab visible again, plus the poll (every 5 s without the channel,
every 30 s with it, so a missed event still shows).

## Seams to check when the four branches are combined

1. **Merge together route.** Not known from here, so the button tries `POST /api/builds/merge-together`, then
   `POST /api/plugins/build-orchestrator/pipeline/merge-together`, body `{ builds: [ids], reason: { title,
   description } }`. If psync-b mounted the lander action under another path, change the two constants at the top of
   `web/mergeTogether.ts`. With neither route the button says "Merge together is not on this server yet".
2. **`waitingFor`** in the merge line may be a build id, a build number or `{ buildId, number, title }`: all three read.
   `mergeLine` is read from `pipelineView.mergeLine`, then `build.mergeLine`, then `build.landing.mergeLine`.
3. **Lander state** without a `pipelineView`: read from `build.landingState`, `build.landing.state` or
   `build.landing.status`.
4. **Status list.** `web/status-table-core.mjs` `BUILD_STATUSES` (the Status filter) is unchanged and
   `status-table.test.mjs` still pins it to `framework/core/pipeline-status.mjs`. If psync-a changed that list, update
   the copy in `status-table-core.mjs` and its `.d.mts` in the combined branch. The badges do not depend on it.
5. **Plan Studio build read.** The test looks for it as `tree.mjs` `api({ op })` under `plan-build`, `build-read`,
   `build-view` or `linked-build`. If psync-c named the op differently, add the name in part 5 of the test; until then
   that check is skipped, not failed.

## The test

    node apps/console-web/plugins/build-orchestrator/test-pipeline-sync.mjs [--json]

Scratch store and scratch plan tree; nothing live is touched. It sends a plan with five trivial steps from Plan Studio
2.0, has the VPS split it, and walks pending, splitting, split, pulling-main, assigning-models, ready, sending,
building, build-complete, failed (attempt 2), the lander's states, landed. At every state it checks the store, the
orchestrator's read (the same `table()` behind `GET /table`) and, when present, the store's own `pipelineView`. A
second build waits at split and must name the first as holding the active place. Then: split provenance, step ids and
build numbers survive later writes and `validateStore`; `pipelineView` is never written to the store file; Plan Studio
and the orchestrator list the same five steps and none is copied into the plan tree.

On this branch alone: **79 passed, 0 failed, 10 skipped.** Every skip names the missing part:

- lander: no `waiting-to-merge` status, `merging` written as `merging-pr`, no `mergeLine`, no Merge together action
- store contract: no `pipelineView` on read, `steps[].splitBy` and `steps[].modelBy` dropped by `normStep`, no build `number`
- Plan Studio 2.0: no build read route (the plan's live rows were compared instead)
- live channel: no `apps/console-web/server/builds_events.py`

Run it again on the combined branch: the skip count should drop to 0. A skip that stays is one of the seams above.

## Checks run

- `test-pipeline-sync.mjs`: 79 passed, 10 skipped
- `status-table.test.mjs` 9/9, `toolbar.test.mjs`, `groups.test.mjs`, `build-id.test.mjs`, `test/p2-status-contract.test.mjs`: pass
- `npm run build` in `apps/console-web` (tsc + vite): pass
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: pass
- `plugin-lifecycle.mjs check build-orchestrator`: its one finding is the launcher's untracked `.brief.md` in the
  worktree root, which names this plugin's folder. Not in the repo, nothing to fix in the branch.

## Not done

- **UI Review: not submitted.** `review.mjs submit --console` needs `AXF_CONSOLE_URL` and `AXF_TOKEN`; this session was
  given neither. Six shots (desktop and phone, fixture data) are in `/root/axf-builds/_shots/psync-d-orch-ui/`. From a
  session that has both, with the combined PR's number:

      S=/root/axf-builds/_shots/psync-d-orch-ui
      node apps/console-web/plugins/ui-review/review.mjs submit --kind screen \
        --name "Build orchestrator: build number, state badges, status line, waiting reason, merge line, split badge, step IDs" \
        --app console-web --screen build-orchestrator --group "psync-d-orch-ui - Nov 24 1:27 AM" \
        --shots $S/psync-d-steps-desktop.png,$S/psync-d-merge-line-desktop.png,$S/psync-d-waiting-desktop.png,$S/psync-d-steps-phone.png,$S/psync-d-merge-line-phone.png,$S/psync-d-waiting-phone.png \
        --build psync-d-orch-ui --branch claude/psync-d-orch-ui --pr <combined PR> \
        --single-option "New columns and lines on the existing builds table, laid out by the brief; no new asset type to choose between." --console

- **No merge line is guessed.** A build shows "Nth to merge" only when the store carries `mergeLine`. The waiting
  reason does have a fallback (the build holding the active place is worked out from the rows).
- **The full report `pipeline-sync-live-badges.md`** that s8 names covers all four parts; it belongs to the session that
  combines them. This file is part D's share.
- **The live watch test** (plan `pipeline-watch-test-seed-plan-7ecc` → build `pipeline-watch-test`) needs everything
  landed and deployed. After landing: open Build orchestrator and Plan Studio 2.0 side by side, send the plan, and at
  each state check both screens show the same badge, the split badge, the build number, the step IDs and, while another
  build is active, the waiting reason.
- Android twin: none for this screen (console web only).
