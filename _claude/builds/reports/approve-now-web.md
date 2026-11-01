# approve-now-web — Approve now on every waiting row in axHub web (Oct 31 2026, Opus, headless VPS)

Branch `claude/approve-now-web`. Brett's screenshot of axhub.amberxai.com: a veto row counting down (0:50) showed
only a pink **Deny**, no Approve now, and the page head said "Nothing waiting" while the top bar said "1 waiting".

## Root cause (two parts)

1. **The live hub is old.** The axHub container on Coolify (`axhub`, uuid `jghxpzuudkahgznvffiwtwmj`) runs commit
   `afffc6e` (deployed Oct 29 04:17). That is **6 commits behind axHub main**: decisions #103 (veto everywhere), #104
   (Approve now + Shelve, `veto.actions`, `POST …/approve-now`) and #105 (`POST …/approve` = Approve now on a held
   call, ntfy notice buttons, `?do=` picks) were merged but never deployed. Hub deploys are manual (no auto-deploy in
   Coolify). That hub sends no `veto.actions`, and the web app treated that as "Deny only" (lib-hub `actionsOf`).
   THREADS.md already listed "axHub redeploy brings Approve now / Shelve" as left over on Oct 30.
2. **The header count leaves held calls out.** The hub's grid `waiting` counts `listPending()` only (status
   `pending`). Held veto calls are `status: "held"` and come separately as `heldCount`, so one held call read as
   "Nothing waiting". The banner counter uses the feed, which includes them, so it said "1 waiting".

## What changed (apps/axhub-web only)

- `src/hub/core.ts` (pure, tested):
  - `heldActions(item)`: the hub's `veto.actions` when sent; **without them (an older hub) Deny + Approve now**, never
    Deny alone; approved-now leaves Deny only.
  - `approveNowPaths(id)`: `/approve-now`, then `/approve`.
  - `waitingCount(grid)` = `waiting` + `heldCount` (or the held rows on the page), and `waitingTitle(n)`.
  - `pickOf()` for `?do=`; `parseRoute`/`routeHash` keep `do` on `#/approvals/<id>?do=…`.
- `HeldCall.tsx`: `HeldBar` shows Deny + **Approve now** (green) as one pair, Shelve as an icon on rows and a button
  on the page. Approve now posts `/approve-now`; on a 404 it tries `/approve`; if the hub has neither, the toast says
  "This hub can't approve a held call yet: it needs updating. Deny still works." A tap flips the row at once: the count
  becomes **Running** (or Denied / Shelved) from the hub's reply, before the next read. The chip says Running when approved.
- `Approvals.tsx`: the header is `waitingTitle(waitingCount(g))` ("1 waiting"). Confirm rows show **Deny | Approve now**
  as the same pair. A long call's Approve now opens its page with Approve now picked. The row takes the hub's reply
  item at once (Approved / Used / Running), and the grid polls every 3 s while a held call is on the page (10 s otherwise).
- `ApprovalDetail.tsx`: the first screen has Deny | Approve now as one pair, then Postpone / Ignore / ….
  **Notice picks are honoured:** `#/approvals/<id>?do=approve-now|approve|deny|shelve` (what the hub's #105 redirect
  sends) marks the picked button (focus ring) and focuses it, with a note: "You picked Approve now in the notice: tap
  Approve now below to do it." One tap decides. A link alone never runs a call (hub decision #105: "the tap decides").
  It says so if the request can't take that action any more.
- `hubPage.tsx`: `useHubJson` keeps what's on screen when the polling speed changes (it only clears on a new address).
- `hub.css` (layout only, tokens only): `.axp-axhub-pair` lays the two buttons out in equal grid columns, so Deny and
  Approve now are the same size. Targets are at least `--fx-row-h` / 4×`--fx-space` (5.5×`--fx-space` ≈ 44 px on phones),
  `white-space: nowrap`. The row title truncates with an ellipsis first, and the buttons never shrink. On phones under
  480 px the pair takes the full width on the request page. The picked button gets a `--fx-focus` ring.
- All controls are framework `Button`s (`tone="success"` / `"danger"`), so colours come from the theme.

## Tests

- `apps/axhub-web/test.mjs`: 201 → 238 checks (+37): heldActions (old hub, shelved, approved, unknown actions),
  approveNowPaths, waitingCount/Title ("1 waiting"), `?do=` parse/round-trip/rejects, source checks (equal pair in all
  three views, no Deny-only default, header uses the count, the reply flips the row, the pair CSS has no colours).
- `npm run build` (axhub-web) green, and green again with the framework re-baked the way CI does it.
- Full local block from `.github/workflows/android.yml`, run in a clean worktree (HEAD + this diff, no synced
  `_claude/shared` copies or session archives): **67 / 67 green** for the framework job (validate, tracker, plugins,
  manifests, fixtures, catalog, profiles, build steps, orch-sync, github, libraries), **check-theme, check-controls,
  check-plugin-pages, plugin lifecycle (every lifecycle plugin)**, check-addons, all of the web block's `check-*.mts`,
  brand library, menu-reach, `apps/axhub-web/test.mjs`, amberx-droid + walkthrough tests, the Python contract/MCP/
  axf_server tests, and the axhub-web re-bake + build.
- Python server tests in `python:3.12`: test_alerts and amberx-droid test_server pass. test_wall_users ("the page
  itself") needs a built console `dist`, and test_plugin_catalog needs the CI checkout's git setup. Both are console-web
  only and untouched by this diff (CI runs them after building the console).
- Plugin `test.mts` in `node:22`: all pass except `output-recorder` (extensionless `./web/core` import under Node's
  type stripping). That one is already on main and untouched by this diff.
- Notes: this host runs Node 20 (CI uses 22) and has no pip/venv, so those groups ran in containers. A run in the
  build worktree also flagged the gitignored `apps/*/_claude/shared` copies synced at session start; CI never sees them.

## Not done here / follow-ups

- **Redeploy the axHub server** (Coolify app `axhub`, to axHub main `c9d1afe`). Without it the button shows but the
  live hub answers with the "needs updating" toast, because the old hub has no approve-now route. This headless run
  can't call axHub (the MCP tools are denied) and there's no Coolify API token on the host, so it went in as a BLOCKED
  banner item with the fix: Coolify → marfco → axhub → **Deploy**.
- The console's approvals-banner veto strip (`apps/console-web/plugins/approvals-banner/web/veto.tsx`) also uses the
  hub's `actions`. It shows Approve as soon as the hub is redeployed, so no code change is needed there.
- AmberX native notice buttons: out of scope (Android shell); the hub's #105 `?do=` redirect lands on the request page above.

## Push and deploy

- Committed as `ae513a64` on `claude/approve-now-web`. `git fetch && git merge origin/main`: already up to date (main is
  still `f7170f65`), so the test run above holds.
- **`git push origin HEAD:main` failed:** "Invalid username or token". This VPS has no GitHub credentials for headless
  runs, so retrying won't help. Raised as banner item `blocked:push-approve-now-web`. The console's own token was not
  borrowed.
- **axhub-web redeploy:** `apps/axhub-web/deploy/install.sh` builds from `main` in `/opt/axhub-web`, and its cron pulls
  main every 5 minutes and re-runs itself. It redeploys by itself once this commit reaches main; running it now would
  rebuild the old code.
- **axHub server redeploy** (the real fix for the missing button): banner item `blocked:axhub-redeploy`.
