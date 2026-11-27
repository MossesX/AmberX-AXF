# psync-b-server-lander: live channel + lander (part B of 4)

Branch `claude/psync-b-server-lander`. No PR opened, nothing landed, CI not run (as briefed: the four parts are combined first).
Requirements: build `pipeline-sync-live-badges`, steps s3 and s4 plus its notes (the Nov 24 lander rule wins over the two approval notes before it).

## What is in it

**Live channel (s3)** `apps/console-web/server/builds_events.py`, one include line in `main.py`
- `POST /api/builds/updated` `{ build, state, rev, at }`: the one update command. Console token or signed-in admin; 401 without.
- `GET /api/builds/events`: Server-Sent Events. Every command becomes one `builds.updated` event on every open screen. No step data in it.
- Fallback watcher: while a screen is connected, the store revision is read every 3 s (through `builds_store` / `data_store.py`). Moved with no command: it sends `builds.updated` itself (`build` and `state` empty). Nobody connected: nothing is polled.
- Heartbeat comment every 20 s, a closed tab is dropped at once, a screen that stops reading gets one "read again" instead of a backlog. Nothing is written to disk.
- `POST /api/builds/merge-together` `{ builds?: [id], off? }`: the Merge together press. It calls the lander's CLI and answers `{ ok, mergeTogether, builds, message }`. This is the route psync-d's button already calls first.

**Lander (s4 + notes)** `deploy/lander/**`
- **Merge rule (Brett, Nov 24).** A green PR is merged as it is, first try, pinned to the head CI went green on. Main having moved no longer pulls main or reruns CI. Only a merge GitHub refuses (405 / 409) makes the lander pull main into the PR and run CI again, at once and by itself.
- **PR 900 / 901 fix.** A build whose steps share one branch that already has an open PR lands on that PR. No `lander/<build>` branch, no second PR, no second CI run. A draft is marked ready first.
- **Landing states.** `landing.state` (`waiting-to-merge`, `merging`, `running-ci`, `landed`, `failed`) is written beside the status on every lander write; a red run keeps `failed` with the landing run's attempt N.
- **Update command.** After every write that changes a build's landing state or its place in line, one `POST <console>/api/builds/updated`. 2.5 s timeout, no retry, never blocks or fails a landing. Console base and token come from `AXF_CONSOLE_URL` / `AXF_TOKEN`, else the `DOMAIN` and `AXF_TOKEN` lines of `.axf-console/env`. `AXF_LANDER_NOTIFY=off` switches it off.
- **Merge line.** Every build in the line gets `mergeLine: { position, waitingFor: { buildId, id, number, title } | null }`, written on the build and as `landing.mergeLine`. Only changes are written. `node deploy/lander/run.mjs line` prints it ("2nd to merge, waiting for build 41").
- **Merge together.** `node deploy/lander/run.mjs merge-together [--builds a,b] [--off]`. On the next tick every build waiting at build-complete goes into one branch (`lander/together-<first build>`) and one PR, CI runs once, one merge lands them all. A build that clashes in code is left out, the clash is named in a note on its record, and it lands by itself afterwards. If the shared PR stops for Brett it is closed and the others go back to one at a time.

## Tests run here

| Check | Result |
| --- | --- |
| `node --test deploy/lander/test/` | 96 pass, 0 fail (76 before; 6 rewritten for the new merge rule, 20 new) |
| `python3 apps/console-web/server/test_builds_events.py` (and under pytest) | 7 pass |
| `node framework/spec/check-landing-line.mjs` | 32 checks pass |
| `node framework/spec/check-json-data-writes.mjs` | pass, no new direct JSON write |
| Real HTTP: two `curl` listeners on the stream, one POST | both got the identical event |
| `run.mjs tick --dry-run` against the real store (scratch data folder) | clean |

Not run: full CI, Playwright, the console's own server test suite.

## For whoever combines the four branches

1. **The merge line is only stored once psync-a is in.** Main's store contract drops `mergeLine`; the lander asks the contract first and writes nothing rather than rewrite it every minute. Checked against the `psync-a-core-2` worktree: it keeps `landing.mergeLine` and `landing.state`, the value stays stable across ticks, and its `pipelineView` reads "2nd to merge, waiting for …". Its whitelist for `landing.state` has no `failed`; the status already says failed, so nothing is lost.
2. **`test_builds_events.py` is not in CI yet.** `.github/workflows/android.yml` lists the server tests one by one (next to `test_alerts.py`, around line 425). It needs one line there; that file is not part of B. The lander tests run in CI already; its glob picks up the new `line.test.mjs`.
3. **The live lander lands the parts one by one today.** A hand build that ends cleanly goes to `build-complete` and the lander picks it up; `psync-d-orch-ui` is already in a lander PR with CI running. To really combine first: `node deploy/lander/run.mjs pause --by <who> --why "combining psync a-d"`, then `resume` after the combined merge. I did not pause it: it stops every landing on the VPS.
4. **Merge together answers before it knows about clashes.** The press only files the request; the tick does the work. So psync-d's `clashed` list stays empty and the clash shows up as a note on the build record and in the lander log.
5. **Light PR checks are still not CI.** If a build's own PR only ran the light checks, the lander starts the one full run on that same PR. No second PR either way.
6. **The VPS lander runs from the `/opt/axf` checkout**, so the new rule is live as soon as main is pulled there. No service change needed.

## Choices made without asking

- The `GET /api/builds/events` stream has no token check, like `/api/events`: an EventSource cannot send a bearer header, and the event holds only a build id, a state word and a revision. Behind the hub the wall's own gate still applies.
- A refused merge still counts as landing attempt 1 (the ladder's ceiling guards against a loop), but its retry is due at once instead of after the 2 minute backoff.
- A build that stopped for Brett has no place in the merge line.
- Merge together ignores the size cap (Brett asked for one go) and leaves emergency builds out (they go first, alone).
