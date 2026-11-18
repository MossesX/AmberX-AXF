# Server auto-lander (auto-lander@1) <!-- axf-plugin:gate -->

Brett, Nov 16 2026: "We need the auto lander to bang shit out on its own. It needs to automatically fix it. We need a
server rule to do that. Make the server do it automatically without the console."

The VPS fixes and lands every finished build on its own. No console needed: it is a systemd timer on the host.

## What it does, every minute
`deploy/auto-lander/auto-lander.mjs tick` (systemd `axf-auto-lander.timer` → `axf-auto-lander.service`):
1. One lock (`<data>/auto-lander/auto-lander.lock`); a second tick while one runs does nothing; a dead holder is replaced.
2. Policy = the `auto-lander` gate rule's settings (gate-rules@1) + the runner's own settings (control.json).
3. Builds: status Built in the builds store, plus every build it is still fixing; one at a time, oldest first.
4. Per build: the PR as a `pr-snapshot@1` from GitHub (ETag cache, shared rate-limit reserve), `reconcile.mjs` closes
   what happened since the last tick, `decide()` (framework/core/auto-lander.mjs) picks the action:
   - clash → `merge-main.mjs`: private worktree, main merged in, generated files from main then regenerated
     (framework/spec/generated-files.json: tracker, axf schemas, fixtures, control inventory, help sync, rebake),
     builds files newer-wins, logs unioned, pushed through the github-token broker. Hand-written clash → a fix session.
   - red CI → `ci-status.mjs` summary (job, step, first errors, the "CI build errors" issue) → `fix-session.mjs`:
     an Opus fix step with Brett's verbatim words added to the build, Queued, account from `claude-workers.mjs route`,
     started through the pipeline's own launch (dispatch token, build lock, `claude-headless.sh --account`, agent slot).
     Never a second session for one build.
   - CI running / none → wait (no CI on a head for 15 min → started once per head).
   - green → `land.mjs queue add <pr>`: the merge queue is the only way anything merges.
   - failures of one kind reach maxAttempts (3) → escalate.
5. State: `<data>/auto-lander/state.json` (auto-lander-state@1). Attempt log: `<data>/auto-lander/attempts/<build>.jsonl`
   (auto-lander-attempt@1, validated, the source of truth: a crash resumes from it).

`<data>` = `/projects/amberx-axf/_data` on the hub (persist.mjs); `AXF_AUTO_LANDER_DIR` overrides.

## Retry and backoff
Every head counts: a fix that pushes and is red again is attempt n+1. Backoff after the n-th failure:
`min(backoffMaxMin, backoffBaseMin × backoffFactor^(n−1))` = 5, 15, 45, 60 min. A try with no result after
`attemptTimeoutMin` (45) is a timeout (a failure).

## Escalation
`escalate.mjs`: the build stops; systems check item `gate-auto-lander` (red, what broke, since when, the last attempt's
log, **Reset and fix now**); one phone push per build through the alert hub (axf.notify@1, type
`gate.auto-lander-escalated` in the gate's notify.json), retried until delivered, resolved on landing or reset.
The item is also red when the service has not ticked for 5 minutes.

## Reach (all four the same)
| | |
| --- | --- |
| Deep link | `view:gate/tab:gate.tabs=auto-lander/tab:gate.auto-lander.tabs=server`, rows `grid:gate.auto-lander/row:<build>`, action `gate.auto-lander.open:<build>` |
| REST | `GET /api/plugins/gate/auto-lander`, `GET …/builds/<build>`, `POST …/run`, `…/retry/<b>`, `…/fix/<b>`, `…/pause`, `…/resume`, `GET/POST …/settings` | <!-- axf-plugin:gate -->
| MCP | `gate_auto_lander_status|build|run|retry|fix|pause|resume|settings|settings_set` |
| CLI | `axf gate auto-lander status|show <b>|run [--now]|retry <b>|fix <b>|pause|resume|settings|set <k> <v>` |
| Voice | console actions `gate.auto-lander.status|open|run|retry|fix|pause|resume|set:<k>:<v>` |
| Settings | Settings → Plugins → Gate → Server auto-lander; `setting:gate.autoLander.<key>` |

## Run it / check it
```bash
sudo bash /opt/axf/deploy/install-console.sh          # installs the timer (axf_auto_lander_install)
systemctl status axf-auto-lander.timer; journalctl -u axf-auto-lander -n 50
node deploy/auto-lander/auto-lander.mjs status        # or tick --dry-run
node --test deploy/auto-lander/test/                  # unit + the whole loop with fakes
python3 apps/console-web/plugins/gate/test_auto_lander.py <!-- axf-plugin:gate -->
```
Spec: `framework/spec/AUTO-LANDER.md`. Report: `_claude/builds/reports/server-auto-lander-fixes-lands.md`.
