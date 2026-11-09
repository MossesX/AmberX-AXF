# The orchestrator is the only launcher (orchestrator-only-launcher)

Built Nov 9 2026 on Opus, branch `claude/orchestrator-only-launcher`. Spec: pending build
`one-way-to-start-builds-the-orchestrator-dispatc` (Brett: "There's only one way to start builds … It has to be the
orchestrator … Not the build manager. Anything with the UI gets API control. That has to be in the briefs." and "I'm
also gonna be able to have the orchestrator send jobs to the API, right?").

## The dispatcher was already on main
`claude/pipeline-rebuild` had landed: its tip (3a94c25a6) is an ancestor of main, so nothing needed a cherry-pick. The
dispatcher is `apps/console-web/plugins/build-orchestrator/pipeline.mjs tick`, run every minute by cron
(`/etc/cron.d/axf-pipeline`, installed). It takes the next Queue build and picks the model per phase (Fable only where a
step needs it). It chooses the account from claude-workers health, so a limited or expired login is skipped ("login
expired until …"). It takes an agent slot through `claude-headless.sh` and records the account and session on the build.
Build Manager and Plan Studio read that same store record.

## One launch path
- **Dispatch token** (`framework/cli/dispatch-gate.mjs`). The tick issues a token for one build and passes it in
  `AXF_DISPATCH_TOKEN`. `claude-headless.sh` checks it before the slot and spends it once the session starts (after the
  look gate, so a look-approval relaunch still passes). A launch without a valid token is refused with exit 3 and the
  line that says how to queue it. That covers any launch that belongs to an orchestrator build (by id, session name or
  brief) and any session named `build-*`. Only a hash of each token is on file, and there is no off switch. Sessions
  that aren't builds (walkthroughs, UI shots, chats) pass. This also blocks axHub `vps.build_start` and hand launches.
- **Build Manager**: Start is now **Queue** / **Send to queue**. It plans as before, then files the build through the new
  capability `axf.build-dispatch@1` straight into the orchestrator's Queue. The axHub `vps.run` launch flow, the launch
  command builder and the approval-retry code are gone.
- **Systems check, Fix with Claude** and **push banner, Claude on failure / Repair**: each fix is filed as a High (P1)
  orchestrator build and queued. The push banner still runs Vinny's mapped command first. Its brief now opens with the
  setup (clone and worktree on the PR branch). It also follows the orchestrator build's status (`fixed`), so it knows
  when to pull again. Neither one calls `vps.run` for a Claude session any more.
- **Feature assist, Build with Mosses**: goes to the orchestrator's Queue instead of opening a Mosses chat build. The
  Fable "park on Pending" path is unchanged.
- New CLI: `pipeline.mjs request --title … [--detail-file f] [--priority P1] [--queue]` (the orchestrator assigns the
  id), `pipeline.mjs show <id>` and `pipeline.mjs route <id> api|subscription|auto`. Matching REST routes and
  MCP/voice commands: `pipeline-request`, `pipeline-route`, `pipeline-settings`, `pipeline-settings-set`.

## API jobs
- API slots from workers-api-routing (`hulu-api`, `mossesx-api`) now appear in the pipeline as `kind: api`. They never
  take a build by themselves.
- **Per-build override**: `pipeline.route = api` (new field in `framework/core/build-pipeline.mjs`). The build runs only
  on an API account. `subscription` keeps it off API.
- **Overflow rule**: the pipeline setting `apiOverflow` is **off by default**. When it's on and every subscription
  account is full or out, the build goes to an API account. Toggle: the Pipeline tab's "API overflow" switch, the
  `pipeline-settings-set` command or `pipeline.mjs set apiOverflow=true`. `apiAccounts` limits which API accounts it
  may use.
- An API account takes a build only if it has a key, is switched on, is under its daily and weekly caps and has room
  (its claude-workers building limit). Otherwise it's skipped and the wait line says why, for example: "mossesx-api: no
  API key saved (Terminal → VPS host → claude-account savekey mossesx-api)". The existing `claude-api-spend` health
  check already raises the banner item for a missing key.
- Turning overflow on and setting a build to API both cost money per token, so they're Brett's own console click (403
  for a session, MCP or voice). Anyone may turn overflow off or set a build to subscription or auto. This follows the
  workers rule that only Brett raises a cap.
- An API run's brief says it is billed per token. The launch note names the rule (override or overflow).

## API rule in every brief
`API_RULE` is in `orchestrator-core.mjs`, using the same hunk as open PR #396, so the two merge cleanly. It goes into
every phase brief, including the dispatcher's, and into the split prompt. The split prompt also asks for each UI step
to name its API part (deep link, state read, actions, settings; REST, MCP, CLI and voice).

## Watchdog hook
`pipeline.mjs` exports `afterTick(fn)`. The function runs at the end of every tick with `{ state, plan, launched,
ended, failed }`; if it throws, the error is logged and the tick carries on. The running-builds watchdog build plugs in
here. Nothing of that watchdog is built in this change.

## Tests
- `build-orchestrator/pipeline.test.mjs`: 27 → 35. New: API settings, API account states (no key, capped, off, full,
  not in the list), routeFor (override, overflow off and on, missing keys and caps named, subscription-only), overflow
  filling up to the cap, the brief and split prompt carrying the API rule, the dispatch-gate verdicts. End to end:
  every dispatcher launch passes the real gate once, and the real `claude-headless.sh` refuses `alpha` without a token
  and `build-feat-x` outside the orchestrator. Also `request`, unique ids, `route` and `show`.
- `build-orchestrator/test.py` 21 → 31 (dispatch service, owner-only API switches, bools reach the CLI).
  `build-orchestrator/test.mjs` 33 (API rule in every brief). Upgrades 12.
- `build-manager/test.py` 39 and `test.mjs` 127 (Start = send to queue, orchestrator off = refused, no launch code
  left). `systems-check/test.py`: the new claudefix checks pass. `push-banner/test.py` 176. `feature-assist/test.py` 30.
- Unchanged and green: worker-routing 44, claude-workers 65, claude-login 57, headless-context 38, agent-slots 56,
  ui-predict 12, agent-swarm 100.
- Console `tsc --noEmit` passes, and so do check-theme, check-controls, check-toolbars, check-chrome-assets and
  check-plugin-commands.

## Known gaps
- `systems-check/test.py` stops at "ask first: red with its Auto fix offered, nothing run". It fails the same way on a
  clean main checkout and has nothing to do with this change.
- `help-coverage --check` was already red on main (claude-accounts `help.json` entry 17 has a bad `kind`; 98.5% against
  a 100% ratchet). The new "API overflow" switch has its help entry, so coverage stays at main's 98.5%.
- The push banner's "git only" tool limit (shell off) used to be enforced by `--allowedTools` on the launch. The
  dispatcher runs every build with the same tools, so for fixes that limit is now a rule in the brief.
- Fixes for other repos (axHub, Build-Pilot) start in an AmberX-AXF build worktree, and the brief's setup moves the
  session to that repo's clone.
- No API key is saved for `hulu-api` or `mossesx-api` yet (see the workers-api-routing report). Until Brett saves one,
  API routing says so and the build waits.
- The UI changes (Build Manager Queue button, Pipeline tab API switch and Runs-on button, API account cards) still need
  UI Review shots.
- `framework/core/build-pipeline.mjs` has no Kotlin twin; it is recorded as deferred in `framework/spec/PORTING.md`.
