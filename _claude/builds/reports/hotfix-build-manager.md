# hotfix-build-manager (Current profile, urgent)

**What Brett said (voice, Nov 4 2026):** "Can you check build manager to see what's going? It says 21 things are going." ... "When I click them, they don't open up, and the steps in the build menu don't work."

Agent: Ping Paulie (headless, Opus). Branch `claude/hotfix-build-manager`.

## What was wrong (found live on the console, phone viewport)

1. **Build rows on the Builds page did nothing on tap.** Not a regression from last night's landings: the Builds view's
   DataGrid had no `onRowClick`, and its only way in, the expand chevron at the end of the row, sits past the right edge
   of a phone screen (the title column alone is 30 spaces wide). The Build manager's own rows were fine. The
   orchestrator's step grid had the same gap (no tap-to-open on a step).
2. **Step ticks "didn't work".** The tick did reach the server, but the Builds page polls the store every 5 s. A poll
   that started before the tick answered after it with the old state and flipped the checkbox back, so it looked dead.
   The checkbox also only changed once the server answered (seconds under load).
3. **"21 going".** The count was the Codebase changes banner's "N in progress" (every change-log entry still marked
   running, even when its session went quiet hours ago) on top of a builds store with 16 builds stuck at `running`:
   `liveStatus` turned any build with one ticked step into `running` for good, and nothing ever took it back.

## Fixes

- Builds page: a tap anywhere on a build row opens it (What Brett said, brief, branch/PR, steps, notes). On a phone a tap
  on a step in the Steps view selects it and opens it.
- Builds page: every read and write takes a ticket; a poll answer older than the latest write (or landing while one is
  in flight) is dropped. Ticks show at once; a refused tick reloads the real state.
- Orchestrator: a tap on a step row opens its details.
- Codebase changes banner: "in progress" counts only entries whose session reported in the last 10 minutes; the quiet
  ones show as "N no word".
- Reconciler rule (`framework/plan/builds-reconcile-core.mjs` `idlePlan` + `aliveIds`, run by the existing
  every-10-minutes `builds-reconcile.mjs --apply`, zero tokens): a `running` build that no agent-slots holder, `axf-<id>`
  tmux session or fresh (15 min) build-log heartbeat names, and that nobody touched for 20 minutes, is settled:
  merged PR → `complete`; every step done → `built` (PR open) / `complete`; else → `pending` with a note "paused: no
  live session or process runs it (worktree kept)". Plan epics are left to the plan; where tmux can't be asked
  (container, laptop) nothing is touched. `AXF_RECONCILE_IDLE=off` switches it off.
- `liveStatus`: a `pending` (paused) build with ticks stays pending until a tick or relaunch makes it running; a merged
  `complete` build stays complete even with steps left unticked.

"Paused" is `pending` + the note, not a new status: a ninth status would touch 133 call sites and the builds@1 contract
(Fable work); the Build manager already shows these as Pending.

## Store cleanup (applied live to main by the reconciler)

- → complete (PR merged): urgent-main-ci-green (#284), molly-console-commands (#288), toolbar-tap-confirm (#272),
  kill-patches-pilot (#258), walkthrough-random-look (#240), molly-opus (#230), layout-repeating-slots (#191).
- → pending (paused, worktree kept): profile-manager, git-status-board, terminal-tabs-left, gizmo-companion,
  browser-automation, profile-switcher-widget, app-style-override, element-inspector, orch-step-click.
- Still running (a live process runs them): land-round-2, plugin-lazy-load (via urgent-land-lazy-loader),
  urgent-land-lazy-loader, hotfix-build-manager. molly-banners, molly-nav-submenus, main-area-tabs and
  terminal-drag-chain-tree were already not running.

## Checks

- `node framework/spec/check-builds-live.mjs`: 42 → 47 passed (5 new: paused stays pending, merged stays complete,
  aliveIds, idlePlan, no-tmux = no change).
- `node framework/spec/check-builds-store.mjs`: 37 passed. build-manager `test.mjs`: 128 passed. builds-page `test.py`:
  14 passed. `tsc --noEmit` (console): clean.
- build-orchestrator `test.mjs`: fails on the live data check "repo store: orchestrator builds are small-stepped" for
  **urgent-land-lazy-loader** (another session's build, a step over 30 min). Before the cleanup it failed on
  kill-patches-pilot; not caused by this change.
- Verified on a 412 px phone viewport against the live API: a tapped build opens; a tick shows at once and holds
  through the next poll; untick holds too. Screenshot: UI Review → Screenshots, group
  "hotfix-build-manager - Nov 4 12:47 PM" (`shots/builds-row-open-phone.png`).
