# Alert every time a build falls back to Pending (alert-every-time-build-falls-back-to)

Built Nov 16 2026 on Opus, branch `claude/alert-every-time-build-falls-back-to`.

Brett (Nov 16 2026 19:12): "Every time something falls back to Pending, I need a fucking alert somewhere."

## What it does
- **Every** move from the Queue or Building back to Pending is caught where all of them meet: the builds store write.
  Each write fires build-hook@1 `status` events; a new listener (`apps/console-web/plugins/build-orchestrator/fell-back.mjs`,
  fell-back@1, `plugin.json → buildHooks`) keeps one record per build in
  `.axf-console/plugins/build-orchestrator/fell-back.json`. Session stopped with steps left, reconciler pause,
  self-check release, CI or land failure, unqueue: all of them are a status write, so none is missed.
- **Banner item per build** in the systems check (health@1 id `build-fell-back:<id>`, red): which build, where it fell
  from, why (the newest build note around the fall-back, else the pipeline note, else the last run's outcome, else who
  moved it), steps left of total and since when. Buttons on the banner row: **Requeue** (the item's ask-first auto-fix,
  `pipeline.mjs queue`) and **Open** (`view:build-orchestrator`).
- **Phone:** a red item is pushed once to the AmberX app (`system:build-fell-back:<id>`, the systems check's push).
- **Clears** when the build is requeued, archived, deleted, finished or put on hold: the item goes green (the phone alert
  resolves) and is removed. A later fall-back of the same build pushes again.
- **No historic flood:** the ledger records when it began and ignores older events, so the listener's first delivery
  (the whole outbox) doesn't light up the 50-odd builds that fell back before this shipped.
- **Worktree changes:** builds changed in a session worktree reach the console's outbox through builds-live without a
  delivery; the console's sync (every 60 s) runs this listener's delivery itself.
- **Dispatcher alert link fixed:** `ALERT_LINK` was `#/build-orchestrator` (a URL hash the alerts library doesn't
  open); it is now the console address `view:build-orchestrator`.
- Systems check: health item links may now be console addresses (`view:…`, `settings:…`); they open in the console
  and show as buttons on the banner row (`LinkTo`, `openLink`).

## How to reach it (all four the same)
- **REST:** `GET /api/plugins/build-orchestrator/pipeline/fell-back` (list), `POST …/pipeline/fell-back/requeue {id}`;
  the banner items are in `GET /api/plugins/systems-check/health`, Requeue also as `POST …/systems-check/health/autofix/build-fell-back:<id>`.
- **MCP / voice:** plugin commands `pipeline-fell-back` ("what fell back to pending") and `pipeline-fell-back-requeue`
  ("requeue skins"); `pipeline-queue` works too.
- **CLI:** `node apps/console-web/plugins/build-orchestrator/fell-back.mjs list [--json]`, `… clear <id>`,
  `node apps/console-web/plugins/build-orchestrator/pipeline.mjs queue <id>`.
- **Deep link:** `view:build-orchestrator` (console_show / console_open).

## Tests
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 56 passed (new: ALERT_LINK, foldFellBack incl.
  history cutoff and replays, fellBackView, ledger listener + prune).
- `python3 apps/console-web/plugins/build-orchestrator/test.py`: 53 passed (new: item registered red and pushed, Requeue
  ask-first, Open link, summary says which/why/steps/since, cleared item goes green and is removed).
- Also green: build-orchestrator `test.mjs`, systems-check `test.py` (231), notify-control `test.py`, `check-build-hook`,
  `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `tsc --noEmit`.
- `check-console-control` reports one finding that is not from this build: `plugins/claude-settings/web/index.tsx:234`
  (TabGroup id from a constant). The inventory was regenerated for the systems-check lines this build moved.

## Related
- Pending build `pending-banner-list-every-pending-build` (Pending banner with Queue / Hold / Archive / Open, "why it fell
  back") overlaps: it should read `fell-back.mjs list` / `GET pipeline/fell-back` for its "why it fell back" column
  instead of working it out again. Not built here (a new banner plugin, bigger than this build); noted on it.
