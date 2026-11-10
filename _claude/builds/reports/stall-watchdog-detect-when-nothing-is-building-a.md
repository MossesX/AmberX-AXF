# Stall watchdog: detect when nothing is building, auto-fix, notify on AmberX

Build `stall-watchdog-detect-when-nothing-is-building-a` · Opus · branch `claude/stall-watchdog-detect-when-nothing-is-building-a`

## Brett said (verbatim)
> Why am I not being notified when it stalls? You need to be monitoring it so you know when it stalls, then try to fix it, then let me know.

## Why it was silent
The dispatcher only raised one alert (`pipeline:idle`), and only from inside its own tick. When the tick itself broke,
nothing reported it. On Nov 10 06:16–16:39 UTC every tick crashed on an unparseable `_claude/builds/store.json`
(`Unterminated string in JSON …`, visible in `/var/log/axf-pipeline.log`). That was 8.5 hours with no build started
and no notification.

## What was built
- `apps/console-web/plugins/build-orchestrator/stall-watchdog.mjs`: runs from its **own cron**, every minute
  (`axf-pipeline-watchdog` in `deploy/install-console.sh`), so a crashing or hung tick is still seen.
  `stall-core.mjs` holds the decisions (pure, tested).
- Detects: (a) nothing building while the Queue, or Urgent/High (P0/P1) Pending builds, wait; (b) a build marked
  running with no tmux session of that build; (c) no finished dispatcher tick for 3+ min, with the reason (the last
  error in the cron log, a tick hung for N min, or no tick at all).
- A finding must last 2 min. Then the watchdog runs the fixes in order, with a fresh look after each, and stops at the
  first fix that clears it: pipeline self-check → release dead slots (back to the Queue) → auto-queue Urgent/High
  Pending builds when the Queue is empty → restart the dispatcher (stop a tick hung 8+ min, run a tick under the
  dispatcher's own lock).
- Each attempt gets a sub-list line under the stall's entry in **Notes → Automatic fixes → Dispatcher stalls**
  (`/projects/_shared/_claude/notes/Automatic fixes/Dispatcher stalls.md`), and an AmberX FYI
  (`pipeline:stall:<spell>:<round>:<fix>`, notify type `pipeline.stall`, push, high). When it is fixed: "Stall fixed",
  and which fix did it.
- Every fix failed → **one** escalation per stall (`pipeline:stall-escalate:<spell>`, type `pipeline.stall-escalate`,
  urgent) with exactly what is missing (e.g. the store does not parse plus the restore command, the cron is not running,
  no account can take the work). It resolves itself when builds move again. Retries run every 20 min. After the
  escalation they are logged but only a success reaches the phone.
- Newly filed Urgent (P0) builds now go to the Queue in `intake()`, whatever the "Launch builds without asking" setting.
  Builds already run, already queued once, or handed back stay where they are.

## How each part is reached
- REST: `GET /api/…/build-orchestrator/pipeline/stall` (status), `POST …/pipeline/stall` (fix now). `GET …/pipeline`
  now carries `stall`.
- MCP / voice: plugin commands `pipeline-stall` ("is the pipeline stalled", "why is nothing building") and
  `pipeline-stall-fix` ("unstick the builds").
- CLI: `node apps/console-web/plugins/build-orchestrator/stall-watchdog.mjs status | run [--force] [--dry] | request`.
- No UI was added: the outputs are AmberX notifications and the Notes entry.

## Tests
- `stall.test.mjs`: 17 checks, covering detection, decide/confirm/retry, the notify keys and an end-to-end run on a
  scratch store with a fake tick: every fix fails → 4 FYIs + 1 escalation + note; a retry fixes it; a dead session is
  released; an Urgent build auto-queues. Added to CI.
- `pipeline.test.mjs` 42 ✓, `test.mjs` 33 ✓, `test.py` 33 ✓ (2 new route checks).
- A dry run on the live store first flagged two healthy builds. The dispatcher had launched them twice, so the store
  held an older session name. Fixed by counting any `axf-<id>--*` session as alive. Live dry run is now clean.

## Open
- The double launch (store keeps the first session name while a second session runs the build) is a dispatcher
  bookkeeping bug outside this build.
- The cron appears when `install-console.sh` re-runs on deploy (the console updater does this when main changes).
- Nothing watches the watchdog itself yet: `status` reports `watching: false` when its last look is 3+ min old.
  The systems check could read that.
