# axhub-web-flicker — the approvals screen stops flashing "Reading the hub" (Nov 1 2026, Opus, headless VPS)

Branch `claude/axhub-web-flicker`, built on main after the Approve-now-web merge (`e48ca208`). Brett (phone): the axHub
approvals screen (apps/axhub-web, also inside AmberX) twitched as a whole and kept showing "Reading the hub" while a
veto countdown ran.

## Root cause

The rows were never remounted by a key change, and the countdown never touched the loading state. The whole page was
being **unmounted and mounted again** from above, and every remount starts the grid empty, which shows "Reading the hub…":

1. **AppShell dropped the whole app for the waiting screen on any failed look re-read.** The developer-app look source
   (`HubAppearanceSource`) re-reads the hub on every window `focus` and every live `change` event. When one read failed
   (a blip, or a lost SSE connection on the phone), the state became `unreachable`. `AppShell` then showed only
   `WaitingForHub` until the next good read, and put the app back, so every view was rebuilt from nothing.
2. **Every good re-read re-applied the same look.** The source sent `ready` and the document again each time. The
   runtime then set a new state with a new `active` object, so every themed piece re-rendered (the "twitch").
3. **The same pattern one level down.** `HubGate`'s session re-read on tab-back could swap the page for an error
   note and back. One failed grid poll put a danger note over the list. lib-hub's `HubWatcher`, which AmberX's
   view uses, swapped the list for "unreachable" on a single missed poll.

## What changed

- Framework (`framework/`, baked into `apps/axhub-web` and `apps/amberx-droid`; CI re-bakes the same way):
  - `core/runtime.ts`: new `appearanceBlocking()`. The waiting screen shows only until the source is ready the first
    time, or while it says `unauthorized`. A source state equal to the current one isn't set again. `applyAppearance`
    sets no state when no slot changed.
  - `react/AppShell.tsx`: the waiting screen now uses `rt.appearanceBlocking()`.
  - `react/hubAppearance.ts`: a re-read matching the last one (same status, version and body) sends no state and no
    document, so the look applies once per real change. Following the hub again resets this.
  - `libs/hub/index.ts`: `HubWatcher` keeps an `ok` list through one unreachable read and reports it on the second
    miss in a row (`HUB_MISSES_SHOWN = 2`). Signed-out and not-admin answers still show at once.
- axhub-web:
  - `hub/core.ts` (pure, tested): `showReading`, `shownError` + `MISSES_SHOWN`, `keepSessionOnFailure`, `sameJson`.
  - `hub/api.ts`: a session re-read with the same answer emits nothing. A blip while signed in keeps the page.
  - `views/hubPage.tsx` `useHubJson`: an unchanged answer keeps the old object. An error over data already on screen
    shows only after a second failed read in a row.
  - `views/Approvals.tsx`: the loading line comes from `showReading`, so it only shows before the first answer. Rows
    are memoised on their content and get a stable `onDone`, so the countdown re-renders only `HeldBar`'s own number.

## Tests

- `apps/axhub-web/scripts/refresh-check.mts` (new, in CI): renders the real Approvals page inside the real AppShell
  against a fake hub (react-test-renderer, now a devDependency). 15 checks:
  - before the first answer: the waiting screen, then the list;
  - refreshes, a failed read, the same look again, and a failed look re-read and back: no row remounted (fiber
    identity), no error flash, the app stays on screen;
  - 2.2 s of countdown: the number ticks, but the header and row props are the same objects (no re-render);
  - "Reading the hub" never appears in any render once the list is on screen.
- Checked against the old code: it fails with the old Approvals/hubPage/api ("one failed read: the list stays") and
  with the old AppShell/runtime ("the same look again: no state change").
- `check-appearance.mts` 99 → 106 checks (unchanged re-reads emit nothing, a real change is emitted once, blocking
  rules). `check-hub.mts` → 341 checks (one blip keeps the list). `apps/axhub-web/test.mjs` 238 → 242 checks.
- The full local test block from `android.yml`: every TS/Node check is green. Python: mcp, contracts,
  assistant_host, axf_server, app_ci, app_catalog and build_profiles are green. Four FastAPI server tests
  (test_alerts, test_wall_users, test_plugin_catalog, amberx test_server) couldn't run here (no fastapi or pip on this
  box). They touch nothing changed here, and CI runs them.
- `check-theme.mjs` ✓, `check-controls.mjs` ✓. Plugin lifecycle: 41/41 clean on a clean checkout. In this worktree, 18
  report stale references, all inside untracked hook data (`sessions/archive`), not in the repo.
- `npm run build` green for axhub-web and amberx-droid.

## Push: blocked

Merged with main (`d9ea1692`) and retested: the block is 52/53. The one failure, `test_wall_users.py` "the page
itself", fails the same way on plain main, so it comes from this machine, not from this change. Theme, controls and
refresh-check pass, and lifecycle is 42/42 on a clean checkout. `git push origin HEAD:main` failed: the VPS GitHub
token is dead (401 from the API for both the console env file and the axf-console container; the brief's
`GIT_CONFIG_*` auth wasn't in the environment). Banner item `blocked:push-axhub-web-flicker` has the steps.
After a new token: `cd /root/axf-builds/flicker && git fetch && git merge origin/main && git push origin HEAD:main`.

## Gaps

- Kotlin twin deferred (Android on hold): logged in `framework/spec/PORTING.md`.
- Other baked copies (console-web, walkthrough-studio) pick this up at CI re-bake. `apps/demo` needs `rebake.mjs`.
  patches-web is left alone (Patches is paused).
- No UI change to review: nothing looks different, it just stops flashing.
