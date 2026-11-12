# One AmberX build notification: veto before every start, pop-up on every finish

Build `one-amberx-build-notification-veto-approval-befo` · Opus · branch `claude/one-amberx-build-notification-veto-approval-befo`

## Brett said (verbatim, Nov 10 2026 02:24)

> Before the orchestrator starts anything, I want a veto approval notification. I don't need two. Get rid of the other one and just make it a veto approval for the AmberX notification.

## What was there

`amberx-phone-pop-up-for-every-build-start-and-fi` (PR #433, built, not merged) sent a `Started:` pop-up after every launch and a `Finished:` pop-up after every session end. The start pop-up was only a notice, so Brett couldn't stop anything with it.

## What changed

This build replaces that one. Its branch is merged into this one, so all of its work (per-run keys, the deep link, `?axf-action=` cold-start links, finish wording, Activity lines) lands here. The old build is archived as superseded and PR #433 is closed in favour of this PR.

**Start = veto, one notification type.** Before every launch (first run, retry, rerun, next phase: every one goes through `plan.launches` in the dispatcher tick), the dispatcher holds the build in `start-holds.json` (pipeline data dir). It raises one alert on the start key `pipeline:run:<id>:<run>`:

- Title: `Veto: Starts in 90 s: <build> on <account> (<model>)`
- Body: `Will do: …`, `Steps: …` (the open steps of the phase), `Model · account · employee`, phase and run.
- `meta.actions`: Approve and Deny (`build-orchestrator.start-approve|start-deny:<id>`), plus `meta.runsAt` and `meta.seconds`.

Every later tick checks the hold:

- **Approve:** it starts on the next tick (the dispatcher ticks about once a minute).
- **No answer:** it starts when the countdown ends.
- **Deny:** the build goes back to Pending at once. The next tick turns the same notification into `Denied: Denied, back in Pending: <build>`.
- **Started:** the launch updates the same notification in place to `Started: <build> on <account> (<model>)`, now with the employee taken from the session name. The finish updates it to the outcome. That's one notification per build, not two.
- **Left the Queue some other way:** if Brett unqueues a held build by hand, the hold is dropped and its alert resolved.

**Settings** (pipeline-settings@1, Build orchestrator → Pipeline → Phone pop-ups):

| Key | Default | Meaning |
|---|---|---|
| `autoApprove` | false | The auto-approve toggle. On = no hold, it starts at once; `notifyStart` then decides whether a `Started` pop-up goes out |
| `vetoSeconds` | 90 | The approvals countdown, 0-600 s. 0 = no wait: the pop-up still goes out and it starts on the same tick |
| `notifyFinish`, `notifySound`, `notifyGrouping` | as before | Unchanged |

**Console mirror.** The Pipeline tab has a **Waiting to start** card. Each held build shows its title, what it will do, steps, model, account, run and employee, a live countdown chip, and Approve / Deny buttons.

**Notifications panel.** The type `pipeline.launched` is now labelled "Build start (veto)". It's the one start type. No new type was added.

Plain code, no AI.

## API (how each part is reached)

- **Deep link:** `<console>/?axf-action=build-orchestrator.open-build:<id>`. The pop-up's tap uses it. Also console_open / console_show with that action.
- **State:** `GET /api/plugins/build-orchestrator/pipeline/holds`, also in `GET …/pipeline` (`holds`). MCP `pipeline-holds`. CLI `pipeline.mjs holds`.
- **Approve / Deny:**
  - REST: `POST …/pipeline/start {id, decision: approve|deny}`
  - MCP: `pipeline-start`
  - CLI: `pipeline.mjs approve|deny <id> [--by who]`
  - Console actions: `build-orchestrator.start-approve:<id>` / `build-orchestrator.start-deny:<id>`
  - Voice: Amber runs the same console action or MCP command.
- **Settings:** `POST …/pipeline/settings {autoApprove, vetoSeconds}`, MCP `pipeline-settings-set`, CLI `pipeline.mjs set vetoSeconds=0`.

## Related builds

- `amberx-phone-pop-up-for-every-build-start-and-fi`: archived as superseded. Its work is in this branch.
- `brief-approval-dialog-before-every-headless-sess`: upgraded rather than duplicated. The veto shows build, steps, model, account and employee before every headless launch. A note on that build says what's still left there: the full brief text view, the Debugging-plugin switch and the group-chat log.

## Tests

- `pipeline.test.mjs`: 41 checks pass. New: a holdVerdict / settings / veto alert unit check, and an end-to-end veto run in a sandbox. That run checks that both builds are held, the veto is on the start key, a second tick doesn't pop up again, `holds` shows the countdown, Deny goes back to Pending at once, Approve is recorded with who approved it, the denied pop-ups are sent, and approving a gone build is refused. The rest of the end-to-end suite runs on a 0 s countdown and covers the veto-then-launch path on the same tick.
- `test.mjs`: 33 checks pass. `test.py`: 36 checks pass. New: `pipeline/start` approve / deny / bad decision, `pipeline/holds`, and `vetoSeconds` / `autoApprove` reaching the CLI.
- `check-theme`, `check-controls` and `check-toolbars` are green, and the console `tsc --noEmit` is clean.
- `plugin-lifecycle check build-orchestrator` reports stale references that are already on main: `framework/cli/dispatch-gate.mjs` and the untracked session files. Nothing added here.

## Open / deferred

- **Employee before the start:** the job router books the named agent inside the launcher, so before the start the veto says "picked by the job router at start". The `Started` update names the employee. Picking the agent earlier would need a booking preview from the agent-swarm capability.
- **AmberX native buttons:** the installed APK shows the veto as a heads-up, and a tap opens the build with Approve and Deny. Rendering `meta.actions` as notification buttons and a live chronometer countdown is the deferred AmberX twin in `framework/spec/PORTING.md`. No new Android work was done here.
- **UI Review:** no screenshots were taken (the VPS headless browser failed on #433). The screen to capture is the Pipeline tab's Waiting to start card and the Phone pop-ups strip, desktop and phone.
- **Real phone test after merge:** the next queued build should pop up a veto. Let one run out, deny one, and approve one.
