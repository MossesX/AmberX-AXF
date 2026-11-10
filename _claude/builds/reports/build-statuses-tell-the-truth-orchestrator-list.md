# build-statuses-tell-the-truth-orchestrator-list (all; Opus; headless dispatcher session)

Brett (Nov 10 2026): "You gotta fix the status of these. They can't say running, and you gotta show if they need
something. Show what they need. And I can't sort by day either. I don't want to be forced to view everything by
category. I don't want a flat list by default, it's got to at least have an expanding row, depending on the root."

## What was wrong

- `derivedStatus()` in the orchestrator core turned any build with one ticked step into **Running** on *any* change
  (a note, a rename, an edit). Nothing ever took Running away, so builds with no session said Running for days: the 11
  `x.*` plan epics since Oct 31, plus `activity-monitor-plugin-live-plain-english-log-o`.
- A session that stopped on purpose with work left went **back to Pending**, with no word on what it needed.
- The Builds grid always grouped by category. The Builds page grid had **no sort at all**, so you couldn't sort by day.

## Statuses (one truth, every surface)

`framework/core/build-pipeline.mjs` (build-pipeline@1, pure):
- `buildTruth(b, { live })` → `{ state, label, tone, need }`. The states are Running, Needs something, Queued, Pending,
  Ready to land (built, PR open), Landed (complete), Failed and Archived. Running is shown only while a live session
  exists. When the host can't be asked, a recorded pipeline session counts.
- `pipeline.need = { kind, text, at, by }`. The kinds are review (UI Review), land (merge / land), signin, credits, key,
  decision, fable, env (disk / env) and resume (restart). Each kind has a label and a button (`NEED_ACTION`) that either
  queues the build (resume, fable) or jumps to the place that answers it (UI Review, the PR, Claude accounts, Keys,
  Systems check). For decision, the button saves Brett's answer as a build note.
- `needFrom(...texts)` reads the exact need from the session report and the build notes.
- `STATUS_AFTER.returned` = `blocked` (shown as Needs something), never `pending`. `canQueue` accepts a build that needs
  something, because queueing it is how a restart or Fable need is answered.

Dispatcher (`pipeline.mjs`):
- `reconcileRunning()` runs on every tick, after `checkEnds()`. A Running build with no live session (tmux session on
  record, any `axf-<id>…` tmux session, or a claude process working in its worktree) is fixed once the 10-min launch
  grace has passed:
  - every step done → Ready to land or Landed
  - a pipeline run under maxRuns → back in the Queue by itself (fix-it-yourself: a restart needs nobody)
  - anything else → Needs something, with the need from its report and notes (default: restart). Brett also gets a phone alert.
- `checkEnds()` records the need when a session stops with work left. Queueing a build or launching it clears the need.
- Alert title "Back in Pending" → "Needs something".

Orchestrator core: `derivedStatus(build, rules, { ticked })`. Only a step tick makes a build Running. An approved upgrade
goes back to the Queue. Reopened finished work goes to Needs something, never Pending. Labels: blocked = Needs something,
built = Ready to land, complete = Landed.

Same everywhere:
- Orchestrator: the badge, the need text and the button on the row and on the card.
- Builds page (Build Manager list): the status chip shows the truth plus the need, the row tone follows it, and the need sentence sits on the row.
- Home card: `buildProgress().active` (the live bar) is true only for a truly running build, and it now carries `truth` and `need`.
- API, MCP, voice: `GET /api/plugins/build-orchestrator/truth[/<id>]` (plugin commands `build-truth` and `build-truth-one`, so the console's MCP / voice get it too).
- CLI: `orchestrator.mjs truth [id]`.
- Answering a need: `pipeline-queue` (REST `POST /pipeline/queue`, MCP, CLI `pipeline.mjs queue <id>`).
- `/state` and `act` (JSON) carry `truth` and the read-only `pipeline`, `planRef` and `kind` on every build.

## The list

Orchestrator → Builds:
- **Group by**, a framework SelectField. Root builds is the default; category, status (the honest state), priority and
  account are optional.
- Root builds view: each root build is one row. It expands to its **child builds** (a nested grid with the same columns;
  each child expands to its own steps) and its own steps. Builds carry no parent link, so `rootsOf()` derives the root:
  `parent` when set, a plan epic whose id / planRef is a dotted prefix (x.assets → x.assets.designer), and a follow-up's
  base build (foo-2 → foo).
- **Sort by**: Date added, Last updated, Date queued, Date built (plus status / time left / next / category / title), with
  a Newest / Oldest switch. It applies inside every group and among each root's children. The choice is remembered
  (`orch-sort2`, `orch-dir2`, `orch-group`), and a column tap uses the same sort.
- Deep link: `#/build-orchestrator?tab=builds&group=status&sort=updated&dir=desc&build=<id>`.

Builds page (Build Manager): Group by (none / category / status / priority / account), Sort by (Your order, Date added,
Last updated, Date queued, status, name, progress) with a direction switch, plus Added / Updated / Queued columns. All of
it is remembered (`builds-sort`, `builds-group`).

## Not done in this phase

- **Screenshots / UI Review:** not taken. A vite build plus Playwright on this branch was past the phase's time.
  Desktop and phone shots and the UI Review submission are still open; the PR says so.
- The Builds page has Group by and sort, but not the root rows (they are in the orchestrator).
- AmberX reads the API (`/truth`). No AmberX APK change.
- Auto-handling covers restart only. A disk / env need is shown and linked to Systems check, not fixed by itself.

## Checks

- `node apps/console-web/plugins/build-orchestrator/test.mjs`: 35 passed
- `node apps/console-web/plugins/build-orchestrator/pipeline.test.mjs`: 38 passed (incl. e2e: a stale Running build is corrected on the tick, queueing clears the need)
- `node framework/spec/check-builds-store.mjs`: 40 passed
- `check-builds-live`: 62 passed
- `check-build-steps`: 44 passed
- `python3 apps/console-web/plugins/builds-page/test.py`: 14 passed
- `check-theme`, `check-controls`, `check-toolbars`: pass
- `plugin-lifecycle check builds-page`: clean
- `tsc --noEmit` (console-web): clean

The baked copy `apps/console-web/src/axf/core/build-pipeline.*` was refreshed. build-pipeline@1 has no spec fixtures
or Kotlin twin, so there is nothing to regenerate.
